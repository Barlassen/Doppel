package ch.doppel.pocket.snap

import ch.doppel.pocket.finance.*
import kotlin.math.abs

sealed interface QrExpense {
    data object InvalidAmount : QrExpense
    data object AlreadyBudgeted : QrExpense
    data class OneOff(val amount: Double) : QrExpense
    data class Recurring(val monthly: Double) : QrExpense
}

private val recurringHint = Regex(
    """pr[äa]mie|praemie|premium|prime|cotisation|monat|monthly|mensuel|abo\b|abonnement|subscription|leasing|miete|loyer|rent\b|rate\b|quartal|quarter|trimest|jahres|annual|annuel|yearly""",
    RegexOption.IGNORE_CASE,
)
private val quarterly = Regex("quartal|quarter|trimest", RegexOption.IGNORE_CASE)
private val annual = Regex("""jahres|annual|annuel|yearly|\bjahr\b|\bp\.a\.""", RegexOption.IGNORE_CASE)

/** Uses the web twin's bill cadence and 5% tolerance for expenses already in the budget. */
fun reviewQrExpense(bill: QrBill, profile: Profile, scenario: Scenario): QrExpense {
    val amount = bill.amount?.takeIf { bill.currency == "CHF" && it > 0 } ?: return QrExpense.InvalidAmount
    if (bill.category != Category.INSURANCE && !recurringHint.containsMatchIn(bill.message)) return QrExpense.OneOff(amount)

    val monthly = jsRound(when {
        quarterly.containsMatchIn(bill.message) -> amount / 3
        annual.containsMatchIn(bill.message) -> amount / 12
        else -> amount
    })
    if (monthly <= 0.0) return QrExpense.InvalidAmount
    fun matches(value: Double) = abs(value - monthly) <= monthly * 0.05
    if (scenario.recurring.any { matches(it.monthly) }) return QrExpense.AlreadyBudgeted
    val merchants = profile.transactions.filter { it.category == bill.category }.groupBy { it.merchant }
    for (transactions in merchants.values) {
        val months = transactions.map { it.date.take(7) }.toSet().size
        if (months >= 2 && matches(transactions.sumOf { it.amount } / months)) return QrExpense.AlreadyBudgeted
    }
    return QrExpense.Recurring(monthly)
}

/** One-off bills use the first simulated month. Recurring bills change the monthly budget. */
fun Scenario.withQrExpense(bill: QrBill, expense: QrExpense): Scenario {
    val label = bill.message.ifBlank { bill.creditor.name }.take(60)
    return when (expense) {
        QrExpense.InvalidAmount, QrExpense.AlreadyBudgeted -> this
        is QrExpense.OneOff -> {
            val id = generateSequence(1) { it + 1 }.map { "qr-bill-$it" }
                .first { candidate -> events.none { it.id == candidate } }
            copy(events = events + LifeEvent(id, EventType.EXPENSE, label, 0, expense.amount, source = EventSource.SNAP))
        }
        is QrExpense.Recurring -> {
            val id = generateSequence(1) { it + 1 }.map { "qr-recurring-$it" }
                .first { candidate -> recurring.none { it.id == candidate } }
            copy(recurring = recurring + RecurringExpense(id, label, expense.monthly, EventSource.SNAP))
        }
    }
}
