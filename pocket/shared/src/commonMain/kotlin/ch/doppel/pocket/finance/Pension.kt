package ch.doppel.pocket.finance

import kotlin.math.floor

const val AHV_AGE = 65
const val P3A_EARLIEST_AGE = 60
const val P3A_PAYOUT_TAX = 0.06
const val RETIREMENT_TAX_FACTOR = 0.75
private const val AHV_MAX_MONTHLY = 2_520
private const val AHV_13TH_FACTOR = 13.0 / 12
private const val AHV_FULL_INCOME = 90_720
private const val AHV_MIN_INCOME = 15_120
private const val AHV_GAP_FACTOR = 0.9
private const val BVG_COORDINATION_DEDUCTION = 26_460
private const val BVG_MIN_COORDINATED = 3_780.0
private const val BVG_CONVERSION_AT_65 = 0.055
private const val BVG_CONVERSION_STEP = 0.0015
private const val SOCIAL_DEDUCTIONS = 0.13
private const val EFFECTIVE_TAX_SHARE = 0.5
const val PAYSLIP_SALARIES = 13

/** Swiss pension parameters used by the Doppel planning model (2025/26). */
fun bvgAgeCredit(age: Int): Double = when {
    age < 25 -> 0.0
    age < 35 -> 0.07
    age < 45 -> 0.10
    age < 55 -> 0.15
    else -> 0.18
}

fun coordinatedSalary(grossYear: Double): Double =
    if (grossYear < 22_680) 0.0 else maxOf(BVG_MIN_COORDINATED, grossYear - BVG_COORDINATION_DEDUCTION)

fun bvgConversionRate(retirementAge: Int): Double =
    (BVG_CONVERSION_AT_65 - BVG_CONVERSION_STEP * (65 - retirementAge)).coerceIn(0.04, 0.0625)

fun ahvMonthly(grossYear: Double): Double {
    val scale = (0.5 + (0.5 * (grossYear - AHV_MIN_INCOME)) / (AHV_FULL_INCOME - AHV_MIN_INCOME)).coerceIn(0.5, 1.0)
    return AHV_MAX_MONTHLY * AHV_13TH_FACTOR * AHV_GAP_FACTOR * scale
}

fun effectiveTaxRate(marginalTaxRate: Double): Double =
    (marginalTaxRate * EFFECTIVE_TAX_SHARE).coerceIn(0.0, 0.45)

internal fun jsRound(value: Double): Double = floor(value + 0.5)

/** Estimates yearly gross and monthly take-home from Swiss Nettolohn (after deductions, before tax). */
fun payslipToIncome(
    netBeforeTaxMonth: Double,
    marginalTaxRate: Double,
    current: Income? = null,
    salaries: Int = PAYSLIP_SALARIES,
): Income {
    val preTaxYear = netBeforeTaxMonth * salaries
    val grossIncomeYear = jsRound(preTaxYear / (1 - SOCIAL_DEDUCTIONS) / 100) * 100
    val takeHomeYear = if (current != null && current.grossIncomeYear > 0 && current.netIncomeMonth > 0) {
        val currentPreTax = current.grossIncomeYear * (1 - SOCIAL_DEDUCTIONS)
        current.netIncomeMonth * 12 + (preTaxYear - currentPreTax) * (1 - marginalTaxRate)
    } else {
        preTaxYear * (1 - effectiveTaxRate(marginalTaxRate))
    }
    return Income(grossIncomeYear, jsRound(takeHomeYear / 12 / 10) * 10)
}
