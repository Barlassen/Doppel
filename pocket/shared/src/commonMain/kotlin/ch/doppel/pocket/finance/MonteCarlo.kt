package ch.doppel.pocket.finance

import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.time.TimeSource
import ch.doppel.pocket.localToday

private data class Market(val mu: Double, val sigma: Double)

private object Assumptions {
    val equity = Market(0.065, 0.16)
    val bonds = Market(0.02, 0.05)
    const val cashRate = 0.003
    const val overdraftRate = 0.06
    const val inflation = 0.012
    const val wageGrowth = 0.012
    val home = Market(0.015, 0.05)
    const val wageVol = 0.01
    const val pillar2Rate = 0.0125
    const val unemploymentReplacement = 0.7
    const val unemploymentInsuredCap = 148_200
    const val crashShock = -0.3
    const val retirementSpending = 0.8
    const val endAge = 90
    const val raiseNetShare = 0.72
    const val panicDrawdown = 0.15
}

private val equityWeight = mapOf(
    RiskProfile.CONSERVATIVE to 0.3,
    RiskProfile.BALANCED to 0.5,
    RiskProfile.GROWTH to 0.8,
)
private const val P3A_EQUITY_WEIGHT = 0.45

/** Doppel uses the upper middle observation for an even number of paths. */
private fun median(xs: List<Double>): Double = if (xs.isEmpty()) 0.0 else xs.sorted()[xs.size / 2]

/** Monthly Monte Carlo of working life, home purchase, retirement and drawdown. */
fun simulate(input: SimInput, thisYear: Int = localToday().year): SimResult {
    require(input.paths > 0) { "At least one path is required" }
    val t0 = TimeSource.Monotonic.markNow()
    val p = input.profile
    val behavior = input.behavior
    val paths = input.paths
    val seed = input.seed
    val a = Assumptions

    val endAge = maxOf(a.endAge, p.retirementAge + 1, p.goal.age + 1)
    val fullMonths = (endAge - p.age) * 12
    val goalYear = maxOf(0, p.goal.age - p.age)
    val goalMonth = goalYear * 12
    val events = input.events.sortedBy { it.month }
    val house = events.firstOrNull { it.type == EventType.HOUSE }
    val months = if (input.horizon == Horizon.GOAL) {
        minOf(fullMonths, maxOf(goalMonth, house?.let { ((it.month / 12) + 1) * 12 } ?: 0, 12))
    } else {
        fullMonths
    }
    val years = months / 12
    val full = months == fullMonths

    val retireMonth = maxOf(0, (p.retirementAge - p.age) * 12)
    val ahvMonth = (maxOf(AHV_AGE, p.retirementAge) - p.age) * 12
    val p3aPayoutMonth = maxOf(retireMonth, (P3A_EARLIEST_AGE - p.age) * 12)
    val conversion = bvgConversionRate(p.retirementAge)
    val ahvToday = ahvMonthly(p.grossIncomeYear)
    val retTax = effectiveTaxRate(p.marginalTaxRate) * RETIREMENT_TAX_FACTOR
    val closingRate = closingCostRate(p.canton)

    val wE = equityWeight.getValue(p.riskProfile)
    val equity = a.equity
    val bonds = a.bonds
    val sqrt12 = sqrt(12.0)
    val eMu = equity.mu / 12
    val eSd = equity.sigma / sqrt12
    val bMu = bonds.mu / 12
    val bSd = bonds.sigma / sqrt12
    val cashM = a.cashRate / 12
    val overdraftM = a.overdraftRate / 12
    val p2M = a.pillar2Rate / 12
    val hMu = a.home.mu / 12
    val hSd = a.home.sigma / sqrt12
    val wageDrift = -0.5 * a.wageVol * a.wageVol

    val optimize = input.optimizeIdleCash
    val optFrom = if (optimize) maxOf(0, input.optimizeFromMonth) else Int.MAX_VALUE
    val leakage = behavior?.leakageRate ?: 0.0
    val monthlyInvest = maxOf(0.0, input.monthlyInvest)
    val baseMonthly = maxOf(p.rentMonth, p.expensesMonth + input.expenseDelta)

    // ---------- path-independent monthly schedule (salary, spending, events) ----------
    val priceIdx = DoubleArray(months)
    val netIncome = DoubleArray(months)
    val grossInc = DoubleArray(months)
    val p2Credit = DoubleArray(months)
    val baseExp = DoubleArray(months)
    val rentArr = DoubleArray(months)
    val oneOff = DoubleArray(months)
    val crash = BooleanArray(months)
    run {
        var wage = 1.0
        var price = 1.0
        val mWage = (1 + a.wageGrowth).pow(1.0 / 12)
        val mInfl = (1 + a.inflation).pow(1.0 / 12)
        for (m in 0 until months) {
            wage *= mWage
            price *= mInfl
            priceIdx[m] = price
            val retired = m >= retireMonth
            var gross = p.grossIncomeYear * wage
            var net = p.netIncomeMonth * wage
            var unemployed = false
            var child = 0.0
            for (e in events) {
                if (e.type == EventType.JOBLOSS && m >= e.month && m < e.month + (e.durationMonths ?: 6)) unemployed = true
                else if (e.type == EventType.RAISE && m >= e.month) {
                    gross += e.amount * wage
                    net += ((e.amount * a.raiseNetShare) / 12) * wage
                } else if (e.type == EventType.CHILD && m >= e.month && m < e.month + (e.durationMonths ?: 216)) child += e.amount * price
                else if (e.type == EventType.CRASH && e.month == m) crash[m] = true
                else if (e.type == EventType.EXPENSE && e.month == m) oneOff[m] -= e.amount
                else if (e.type == EventType.INCOME && e.month == m) oneOff[m] += e.amount
            }
            if (unemployed) {
                // 70% of the insured salary, capped at CHF 148,200/yr.
                val f = if (gross > 0) a.unemploymentReplacement * minOf(1.0, (a.unemploymentInsuredCap * wage) / gross) else 0.0
                net *= f
                gross *= f
            }
            val ageNow = p.age + (m / 12)
            netIncome[m] = if (retired) 0.0 else net
            grossInc[m] = if (retired) 0.0 else gross
            // BVG savings credits stop during unemployment (ALV only insures death & disability).
            p2Credit[m] = if (retired || unemployed) 0.0 else (bvgAgeCredit(ageNow) * coordinatedSalary(gross / wage) * wage) / 12
            val living = if (retired) (baseMonthly - p.rentMonth) * a.retirementSpending + p.rentMonth else baseMonthly
            baseExp[m] = living * price + child
            rentArr[m] = p.rentMonth * price
        }
    }

    val nw = DoubleArray(paths * (years + 1))
    var successes = 0
    var crunches = 0
    val atGoal = DoubleArray(paths)
    // house stats
    var bought = 0
    val hardAtPurchase = mutableListOf<Double>()
    val p2AtPurchase = mutableListOf<Double>()
    val grossAtPurchase = mutableListOf<Double>()
    val equityIn = mutableListOf<Double>()
    val loans = mutableListOf<Double>()
    // retirement stats
    val depletion = DoubleArray(paths) { Double.POSITIVE_INFINITY }
    val liquidAtRet = mutableListOf<Double>()
    val bvgReal = mutableListOf<Double>()
    val spendRet = mutableListOf<Double>()

    for (path in 0 until paths) {
        val ps = pathSeed(seed, path)
        val randn = normalSampler(mulberry32(ps))
        // Separate stream for behavioural coin-flips so "ideal" and "real" twins see the same markets.
        val brand = mulberry32(ps xor 0x5bd1e995)

        var cash = p.cash
        var port = p.portfolio
        var parked = 0.0 // panic-sold money waiting in cash
        var p3a = p.pillar3a
        var p2 = p.pillar2
        var homeValue = 0.0
        var mortgage = 0.0
        var amortMonthly = 0.0
        var mortgageFloor = 0.0
        var owner = false
        var houseFailed = false
        var crunch = false
        var idx = 1.0
        var peak = 1.0
        var episodeUsed = false
        var reentryLevel = 0.0
        var outMonths = 0
        var p3aYear = 0.0
        var wf = 1.0 // this future's career factor on top of average wage growth
        var bvgMonthly = 0.0
        var p2AtRet = 0.0

        val row = path * (years + 1)
        nw[row] = cash + port + p3a + p2

        for (m in 0 until months) {
            val price = priceIdx[m]
            val optimizing = m >= optFrom
            if (m == optFrom) {
                val buffer = BUFFER_MONTHS * baseExp[m]
                if (cash > buffer) {
                    port += cash - buffer
                    cash = buffer
                }
            }

            // --- markets (same draws for every scenario on this path) ---
            val rE = if (crash[m]) a.crashShock else eMu + eSd * randn()
            val rB = bMu + bSd * randn()
            val rH = hMu + hSd * randn()
            if (m % 12 == 0) {
                val z = randn()
                if (m > 0) wf *= exp(a.wageVol * z + wageDrift)
            }
            idx *= 1 + rE
            if (idx > peak) {
                peak = idx
                episodeUsed = false
            }
            port *= 1 + wE * rE + (1 - wE) * rB
            parked *= 1 + cashM
            p3a *= 1 + P3A_EQUITY_WEIGHT * rE + (1 - P3A_EQUITY_WEIGHT) * rB
            if (m < retireMonth) p2 *= 1 + p2M
            cash *= 1 + (if (cash > 0) cashM else overdraftM)
            if (owner) homeValue *= 1 + rH

            // --- behavioural twin: panic selling at the bottom, buying back only after the recovery ---
            if (parked > 0) {
                outMonths++
                if (outMonths >= (behavior?.panicOutMonths ?: 6) && idx >= reentryLevel) {
                    port += parked
                    parked = 0.0
                }
            } else if (behavior != null && !episodeUsed && idx < peak * (1 - a.panicDrawdown)) {
                episodeUsed = true
                if (brand() < behavior.panicSellProb) {
                    val sold = port * behavior.panicSellShare
                    port -= sold
                    parked = sold
                    reentryLevel = peak
                    outMonths = 0
                }
            }

            // --- retirement transition ---
            if (m == retireMonth) {
                liquidAtRet.add((cash + port + parked + p3a) / price)
                p2AtRet = p2
                bvgMonthly = (p2 * conversion) / 12
                bvgReal.add(bvgMonthly / price)
                p2 = 0.0
            }
            if (m == p3aPayoutMonth && p3a > 0) {
                port += p3a * (1 - P3A_PAYOUT_TAX)
                p3a = 0.0
            }

            // --- income & spending ---
            val retired = m >= retireMonth
            val income = if (retired) {
                (bvgMonthly + (if (m >= ahvMonth) ahvToday * price else 0.0)) * (1 - retTax)
            } else {
                netIncome[m] * wf
            }
            var expenses = baseExp[m]
            cash += oneOff[m]

            // --- home purchase: the bank test runs at the purchase date with this future's equity & salary ---
            if (house != null && m == house.month) {
                val buffer = BUFFER_MONTHS * expenses
                val hardAvail = maxOf(0.0, cash - buffer) + parked + port + p3a
                val gross = if (retired) (bvgMonthly + (if (m >= ahvMonth) ahvToday * price else 0.0)) * 12 else grossInc[m] * wf
                hardAtPurchase.add(hardAvail)
                grossAtPurchase.add(gross)
                p2AtPurchase.add(p2)
                val plan = tragbarkeit(AffordabilityInput(house.amount, gross, hardAvail, p2, closingRate))
                if (!plan.pass) {
                    houseFailed = true // keep renting
                } else {
                    var need = plan.hardUsed + plan.closingCosts
                    val fromCash = minOf(need, maxOf(0.0, cash - buffer))
                    cash -= fromCash
                    need -= fromCash
                    val fromParked = minOf(need, parked)
                    parked -= fromParked
                    need -= fromParked
                    val fromPort = minOf(need, port)
                    port -= fromPort
                    need -= fromPort
                    p3a = maxOf(0.0, p3a - need)
                    p2 -= plan.pillar2Used
                    owner = true
                    homeValue = house.amount
                    mortgage = plan.loan
                    mortgageFloor = house.amount * FIRST_MORTGAGE_SHARE
                    amortMonthly = maxOf(0.0, mortgage - mortgageFloor) / AMORTISATION_YEARS / 12
                    bought++
                    equityIn.add(plan.equity)
                    loans.add(plan.loan)
                }
            }
            if (owner) {
                // Interest on the current loan, upkeep on the current value, amortisation down to ⅔ of the price.
                val amort = if (mortgage > mortgageFloor) minOf(amortMonthly, mortgage - mortgageFloor) else 0.0
                mortgage -= amort
                expenses += (mortgage * ACTUAL_MORTGAGE_RATE) / 12 + (homeValue * MAINTENANCE_RATE) / 12 + amort - rentArr[m]
            }
            if (m == retireMonth) spendRet.add(expenses / price)

            // --- savings flow ---
            var surplus = income - expenses
            if (!retired) {
                p2 += p2Credit[m] * wf
                if (surplus > 0 && monthlyInvest > 0) {
                    val order = minOf(monthlyInvest, surplus) // pay yourself first: leaves before payday spending
                    port += order
                    surplus -= order
                }
                if (surplus > 0 && leakage > 0) surplus *= 1 - leakage
                if ((p.contributes3a || optimizing) && surplus > 0) {
                    val c = minOf(PILLAR_3A_MAX / 12, surplus)
                    p3a += c
                    p3aYear += c
                    surplus -= c
                }
                if (m % 12 == 11) {
                    cash += p3aYear * p.marginalTaxRate
                    p3aYear = 0.0
                }
            }
            if (surplus > 0) {
                val inv = surplus * (if (optimizing) 1.0 else if (retired) 0.0 else p.investShare)
                port += inv
                cash += surplus - inv
            } else {
                cash += surplus
            }

            if (optimizing) {
                val buffer = BUFFER_MONTHS * expenses
                if (cash > buffer * 1.5) {
                    port += cash - buffer
                    cash = buffer
                }
            }

            // --- shortfall: sell investments; if nothing is left, it's a cash crunch (or savings depleted) ---
            if (cash < 0) {
                var need = -cash
                val fromParked = minOf(parked, need)
                parked -= fromParked
                need -= fromParked
                val fromPortfolio = minOf(port, need)
                port -= fromPortfolio
                need -= fromPortfolio
                if (need > 0 && p.age + m / 12.0 >= P3A_EARLIEST_AGE) {
                    val c = minOf(p3a, need)
                    p3a -= c
                    need -= c
                }
                cash = -need
                if (need > 1) {
                    if (!retired) {
                        if (m < goalMonth) crunch = true
                    } else if (depletion[path] == Double.POSITIVE_INFINITY) depletion[path] = p.age + m / 12.0
                }
            }

            if (m % 12 == 11) {
                val y = (m + 1) / 12
                val p2Value = if (retired) p2AtRet * maxOf(0.0, 1 - (m + 1 - retireMonth).toDouble() / (fullMonths - retireMonth)) else p2
                nw[row + y] = (cash + port + parked + p3a + p2Value + (if (owner) homeValue - mortgage else 0.0)) / price
            }
        }

        val goalWorth = nw[row + minOf(years, goalYear)]
        atGoal[path] = goalWorth
        if (crunch) crunches++
        if (!crunch && !houseFailed && goalWorth >= p.goal.target) successes++
    }

    val bands = ArrayList<YearBand>(years + 1)
    val col = DoubleArray(paths)
    for (y in 0..years) {
        for (i in 0 until paths) col[i] = nw[i * (years + 1) + y]
        col.sort()
        bands.add(YearBand(
            year = thisYear + y,
            age = p.age + y,
            p10 = col[(paths * 0.1).toInt()],
            p50 = col[(paths * 0.5).toInt()],
            p90 = col[(paths * 0.9).toInt()],
        ))
    }
    atGoal.sort()

    val houseStats = if (house != null && house.month < months) {
        HouseStats(
            eventId = house.id,
            label = house.label,
            labelMsg = house.labelMsg,
            price = house.amount,
            month = house.month,
            boughtProb = bought.toDouble() / paths,
            medianHardEquity = median(hardAtPurchase),
            medianPillar2 = median(p2AtPurchase),
            grossAtPurchase = median(grossAtPurchase),
            closingRate = closingRate,
            medianEquityAtPurchase = median(equityIn),
            medianLoan = median(loans),
        )
    } else null

    val retirement = if (full && retireMonth < months && retireMonth > 0) {
        val dep = depletion.apply { sort() }
        val p10 = dep[(paths * 0.1).toInt()]
        val bvg = median(bvgReal)
        val lastGrossMonthly = grossInc[retireMonth - 1] / priceIdx[retireMonth - 1] / 12
        RetirementStats(
            age = p.retirementAge,
            lastsTo90Prob = dep.count { it == Double.POSITIVE_INFINITY }.toDouble() / paths,
            depletionAgeP10 = if (p10.isFinite()) p10.toInt() else null,
            replacementRatio = if (lastGrossMonthly > 0) (bvg + ahvToday) / lastGrossMonthly else 0.0,
            monthlyIncomeAtRetirement = bvg + ahvToday,
            ahvMonthly = ahvToday,
            bvgMonthly = bvg,
            monthlySpending = median(spendRet),
            medianLiquidAtRetirement = median(liquidAtRet),
            bridgeYears = maxOf(0, AHV_AGE - p.retirementAge),
        )
    } else null

    return SimResult(
        bands = bands,
        successProb = successes.toDouble() / paths,
        crunchProb = crunches.toDouble() / paths,
        medianAtGoal = atGoal[paths / 2],
        goalMonth = goalMonth,
        retirementAge = p.retirementAge,
        ms = t0.elapsedNow().inWholeNanoseconds / 1e6,
        paths = paths,
        house = houseStats,
        retirement = retirement,
    )
}
