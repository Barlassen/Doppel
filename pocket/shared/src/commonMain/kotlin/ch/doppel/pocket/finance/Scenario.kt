package ch.doppel.pocket.finance

fun baseScenario(profile: Profile): Scenario = Scenario(events = profile.events)

fun effectiveProfile(profile: Profile, scenario: Scenario): Profile = profile.copy(
    grossIncomeYear = scenario.income?.grossIncomeYear ?: profile.grossIncomeYear,
    netIncomeMonth = scenario.income?.netIncomeMonth ?: profile.netIncomeMonth,
    expensesMonth = profile.expensesMonth + scenario.recurring.sumOf { it.monthly },
    riskProfile = scenario.riskProfile ?: profile.riskProfile,
    contributes3a = scenario.contributes3a ?: profile.contributes3a,
    retirementAge = scenario.retirementAge ?: profile.retirementAge,
)

fun simInputFor(profile: Profile, scenario: Scenario, behavior: BehaviorParams? = null): SimInput = SimInput(
    profile = effectiveProfile(profile, scenario),
    events = scenario.events,
    behavior = behavior,
    expenseDelta = scenario.expenseDelta,
    optimizeIdleCash = scenario.optimize,
    monthlyInvest = scenario.monthlyInvest,
)

data class TwinResult(val behavior: BehaviorProfile, val ideal: SimResult, val real: SimResult)

fun calculateTwins(profile: Profile, scenario: Scenario): TwinResult {
    val behavior = analyzeBehavior(effectiveProfile(profile, scenario), scenario.extraTx)
    val input = simInputFor(profile, scenario)
    return TwinResult(behavior, simulate(input), simulate(input.copy(behavior = behavior.params)))
}

fun shiftEvent(events: List<LifeEvent>, id: String, deltaMonths: Int): List<LifeEvent> =
    events.map { if (it.id == id) it.copy(month = maxOf(0, it.month + deltaMonths)) else it }

data class HabitCosts(val leakagePp: Double, val panicPp: Double)

fun habitCosts(input: SimInput): HabitCosts? {
    val behavior = input.behavior ?: return null
    fun run(params: BehaviorParams) =
        simulate(input.copy(behavior = params, paths = 500, seed = HEADLINE_SEED, horizon = Horizon.GOAL)).successProb
    val base = run(behavior)
    return HabitCosts(
        (run(behavior.copy(leakageRate = 0.0)) - base) * 100,
        (run(behavior.copy(panicSellProb = 0.0)) - base) * 100,
    )
}

data class WaitingCost(val label: Message, val startMonth: Int, val prob: Double)

fun costOfWaiting(input: SimInput): List<WaitingCost>? {
    if (input.optimizeIdleCash) return null
    val base = input.copy(seed = HEADLINE_SEED, paths = HEADLINE_PATHS, horizon = Horizon.GOAL)
    fun run(month: Int) = simulate(base.copy(optimizeIdleCash = true, optimizeFromMonth = month)).successProb
    return listOf(
        WaitingCost(message("waiting.now"), 0, run(0)),
        WaitingCost(message("waiting.inYears", "count" to 2), 24, run(24)),
        WaitingCost(message("waiting.inYears", "count" to 5), 60, run(60)),
        WaitingCost(message("waiting.never"), -1, simulate(base).successProb),
    )
}
