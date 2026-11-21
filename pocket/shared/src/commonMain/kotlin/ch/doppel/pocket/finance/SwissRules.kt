package ch.doppel.pocket.finance

import kotlin.math.floor

const val STRESS_RATE = 0.05
const val MAINTENANCE_RATE = 0.01
const val MAX_COST_TO_INCOME = 1.0 / 3
const val MIN_EQUITY = 0.2
const val MIN_HARD_EQUITY = 0.1
const val FIRST_MORTGAGE_SHARE = 2.0 / 3
const val AMORTISATION_YEARS = 15
const val PILLAR_3A_MAX = 7258.0
const val ACTUAL_MORTGAGE_RATE = 0.018
const val BUFFER_MONTHS = 3

fun closingCostRate(canton: String): Double = when (canton) {
    "GE", "VD", "NE", "FR" -> 0.03
    "ZH" -> 0.015
    "ZG", "SZ" -> 0.01
    else -> 0.02
}

data class AffordabilityInput(
    val price: Double,
    val grossIncomeYear: Double,
    val hardEquityAvailable: Double,
    val pillar2Available: Double,
    val closingRate: Double = 0.0,
)

data class YearlyCost(val interest: Double, val maintenance: Double, val amortisation: Double) {
    val total: Double get() = interest + maintenance + amortisation
}

data class TragbarkeitPlan(
    val pass: Boolean,
    val hardUsed: Double,
    val pillar2Used: Double,
    val equity: Double,
    val loan: Double,
    val closingCosts: Double,
    val yearlyCost: YearlyCost,
    val costToIncome: Double,
    val equityGap: Double,
    val incomeGap: Double,
    val extraEquityToPass: Double,
)

data class AffordabilityResult(val plan: TragbarkeitPlan, val price: Double, val maxPrice: Double) {
    val equityNeeded: Double get() = maxOf(price * MIN_EQUITY, plan.equity)
    val hardEquityNeeded: Double get() = price * MIN_HARD_EQUITY
    val equityUsed: Double get() = plan.equity
    val hardEquityUsed: Double get() = plan.hardUsed
}

fun maxLoanForIncome(price: Double, grossIncomeYear: Double): Double {
    val budget = grossIncomeYear * MAX_COST_TO_INCOME - price * MAINTENANCE_RATE
    if (budget <= 0) return 0.0
    val first = price * FIRST_MORTGAGE_SHARE
    val onlyFirst = budget / STRESS_RATE
    if (onlyFirst <= first) return onlyFirst
    return (budget + first / AMORTISATION_YEARS) / (STRESS_RATE + 1.0 / AMORTISATION_YEARS)
}

/** Uses the smallest available equity that passes the stress test, or all eligible funds when it fails. */
fun tragbarkeit(input: AffordabilityInput): TragbarkeitPlan {
    val price = input.price
    val gross = input.grossIncomeYear
    val closingCosts = price * input.closingRate
    val hard = maxOf(0.0, input.hardEquityAvailable - closingCosts)
    val minEq = price * MIN_EQUITY
    val target = minOf(price, maxOf(minEq, price - maxLoanForIncome(price, gross)))
    val hardUsed = minOf(hard, target)
    val pillar2Used = maxOf(0.0, minOf(input.pillar2Available, minEq - hardUsed))
    val equity = hardUsed + pillar2Used
    val loan = maxOf(0.0, price - equity)
    val yearlyCost = YearlyCost(
        interest = loan * STRESS_RATE,
        maintenance = price * MAINTENANCE_RATE,
        amortisation = maxOf(0.0, loan - price * FIRST_MORTGAGE_SHARE) / AMORTISATION_YEARS,
    )
    val costToIncome = if (gross > 0) yearlyCost.total / gross else Double.POSITIVE_INFINITY
    val equityGap = maxOf(maxOf(0.0, price * MIN_HARD_EQUITY - hardUsed), maxOf(0.0, minEq - equity))
    val pass = equityGap == 0.0 && costToIncome <= MAX_COST_TO_INCOME + 1e-9
    return TragbarkeitPlan(
        pass, hardUsed, pillar2Used, equity, loan, closingCosts, yearlyCost, costToIncome, equityGap,
        if (pass) 0.0 else maxOf(0.0, yearlyCost.total / MAX_COST_TO_INCOME - gross),
        if (pass) 0.0 else maxOf(0.0, target - equity),
    )
}

fun checkAffordability(input: AffordabilityInput): AffordabilityResult = AffordabilityResult(
    tragbarkeit(input), input.price,
    maxAffordablePrice(input.grossIncomeYear, input.hardEquityAvailable, input.pillar2Available, input.closingRate),
)

fun maxAffordablePrice(gross: Double, hard: Double, p2: Double, closingRate: Double = 0.0): Double {
    var lo = 0.0
    var hi = 20_000_000.0
    repeat(40) {
        val mid = (lo + hi) / 2
        if (tragbarkeit(AffordabilityInput(mid, gross, hard, p2, closingRate)).pass) lo = mid else hi = mid
    }
    return floor(lo / 1000) * 1000
}

fun ownershipMonthlyCost(price: Double, loan: Double): Double {
    val interest = loan * ACTUAL_MORTGAGE_RATE
    val maintenance = price * MAINTENANCE_RATE
    val secondMortgage = maxOf(0.0, loan - price * FIRST_MORTGAGE_SHARE)
    return (interest + maintenance + secondMortgage / AMORTISATION_YEARS) / 12
}

fun pillar3aTaxSaving(contribution: Double, marginalTaxRate: Double): Double =
    minOf(contribution, PILLAR_3A_MAX) * marginalTaxRate

fun HouseStats.affordability(): AffordabilityResult = checkAffordability(
    AffordabilityInput(price, grossAtPurchase, medianHardEquity, medianPillar2, closingRate),
)
