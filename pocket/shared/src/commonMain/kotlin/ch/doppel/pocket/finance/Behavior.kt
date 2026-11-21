package ch.doppel.pocket.finance

import ch.doppel.pocket.finance.Category.*

data class BehaviorInsight(val id: String, val title: Message, val detail: Message, val monthlyChf: Double? = null)
data class Subscription(val merchant: String, val monthly: Double)
data class MonthSpending(val discretionary: Double, val total: Double, val count: Int, val baseline: Double)
data class BehaviorProfile(
    val params: BehaviorParams,
    val paydaySpike: Double,
    val subscriptions: List<Subscription>,
    val discretionaryShare: Double,
    val insights: List<BehaviorInsight>,
    val leakageChfMonth: Double,
    val historyMonths: Int,
    val thisMonth: MonthSpending,
    val spendTip: Message,
)

private val discretionary = setOf(DINING, SHOPPING, TRAVEL, SUBSCRIPTIONS)
private const val PAYDAY = 25

/** Baseline habits use profile transactions. Imported transactions only affect this month's figures. */
fun analyzeBehavior(profile: Profile, extra: List<Transaction> = emptyList()): BehaviorProfile {
    val tx = profile.transactions
    val historyMonths = tx.map { it.date.take(7) }.toSet().size.coerceAtLeast(1)
    val flex = tx.filter { it.category in discretionary }
    var after = 0.0
    var before = 0.0
    for (t in flex) {
        val day = t.date.drop(8).take(2).toIntOrNull() ?: continue
        if (day >= PAYDAY || day <= 2) after += t.amount else before += t.amount
    }
    val paydaySpike = if (before > 0) after / 9 / (before / 22) else 1.0

    val subscriptions = tx.filter { it.category == SUBSCRIPTIONS }.groupBy { it.merchant }
        .mapNotNull { (merchant, transactions) ->
            val months = transactions.map { it.date.take(7) }.toSet().size
            if (months < 2) null else Subscription(merchant, jsRound(transactions.sumOf { it.amount } / months))
        }.sortedByDescending { it.monthly }

    val disc = flex.sumOf { it.amount }
    val total = tx.sumOf { it.amount }.let { if (it == 0.0) 1.0 else it }
    val discretionaryShare = disc / total
    val leakageRate = (
        0.03 + minOf(0.1, maxOf(0.0, paydaySpike - 1) * 0.03) + maxOf(0.0, discretionaryShare - 0.25) * 0.3
    ).coerceIn(0.0, 0.3)
    val sold = profile.history.drawdownSellPct
    val soldBefore = profile.history.soldInDrawdown
    val panicSellProb = if (soldBefore) (0.3 + 0.6 * sold).coerceIn(0.0, 0.95) else 0.08
    val panicSellShare = if (soldBefore) sold.coerceIn(0.1, 1.0) else 0.5
    val params = BehaviorParams(leakageRate, panicSellProb, panicSellShare, 6)
    val surplus = maxOf(0.0, profile.netIncomeMonth - profile.expensesMonth)
    val leakageChfMonth = jsRound(leakageRate * surplus)

    val insights = buildList {
        if (paydaySpike > 1.25) {
            val extraMonthly = jsRound(((after / 9 - before / 22) * 9) / historyMonths)
            add(BehaviorInsight("payday", message("insight.paydayTitle", "x" to paydaySpike),
                message("insight.paydayDetail", "x" to paydaySpike), extraMonthly))
        }
        if (leakageChfMonth > 0) {
            add(BehaviorInsight("leak", message("insight.leakTitle", "rate" to leakageRate),
                message("insight.leakDetail", "surplus" to surplus), leakageChfMonth))
        }
        if (subscriptions.isNotEmpty()) {
            val items = subscriptions.map { message("insight.subsItem", "merchant" to it.merchant, "amount" to it.monthly) }
            add(BehaviorInsight("subs", message("insight.subsTitle", "count" to subscriptions.size),
                message("insight.subsList", "items" to items), subscriptions.sumOf { it.monthly }))
        }
        if (soldBefore) {
            add(BehaviorInsight("panic", message("insight.panicTitle"),
                message("insight.panicDetail", "sold" to sold, "prob" to panicSellProb)))
        }
    }

    val thisMonth = MonthSpending(
        jsRound(extra.filter { it.category in discretionary }.sumOf { it.amount }),
        jsRound(extra.sumOf { it.amount }),
        extra.size,
        jsRound(disc / historyMonths),
    )
    val spendTip = if (paydaySpike > 1.25) {
        message("insight.tipPayday")
    } else {
        val top = flex.groupBy { it.category }.mapValues { (_, items) -> items.sumOf { it.amount } }
            .maxByOrNull { it.value }
        if (top == null) message("insight.tipFixed") else message(
            "insight.tipCategory",
            "category" to message("category.${top.key.name.lowercase()}"),
            "amount" to jsRound(top.value / historyMonths),
        )
    }

    return BehaviorProfile(params, paydaySpike, subscriptions, discretionaryShare, insights,
        leakageChfMonth, historyMonths, thisMonth, spendTip)
}
