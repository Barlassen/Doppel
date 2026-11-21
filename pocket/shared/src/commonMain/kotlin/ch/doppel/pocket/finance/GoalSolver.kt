package ch.doppel.pocket.finance

import kotlin.math.ceil
import kotlin.time.TimeSource

sealed interface RecipePatch {
    data class ExpenseDelta(val value: Double) : RecipePatch
    data object Optimize : RecipePatch
    data class Delay(val eventId: String, val months: Int) : RecipePatch
    data class Combo(val eventId: String, val months: Int, val expenseDelta: Double) : RecipePatch
}

data class Recipe(
    val id: String,
    val title: Message,
    val detail: Message,
    val newProb: Double,
    val apply: RecipePatch,
) {
    val reaches: Boolean get() = newProb >= TARGET
}

data class SolverResult(val baseProb: Double, val recipes: List<Recipe>, val ms: Double)
private data class Cut(val cut: Double, val prob: Double)

const val TARGET = 0.8
private const val SEARCH_PATHS = 300
private const val SEARCH_SEED = 7
private const val MAX_CUT = 2_500.0

/** Searches cheaper paths, then scores each recipe using the same paths as the headline. */
fun solveGoal(base: SimInput, spendTip: Message? = null): SolverResult {
    val start = TimeSource.Monotonic.markNow()
    fun search(input: SimInput) = simulate(input.copy(paths = SEARCH_PATHS, seed = SEARCH_SEED, horizon = Horizon.GOAL))
    fun score(input: SimInput) = simulate(input.copy(paths = HEADLINE_PATHS, seed = HEADLINE_SEED, horizon = Horizon.GOAL))

    val baseRun = score(base)
    val baseProb = baseRun.successProb
    val recipes = mutableListOf<Recipe>()
    fun done() = SolverResult(
        baseProb, recipes.sortedWith(compareByDescending<Recipe> { it.reaches }.thenByDescending { it.newProb }),
        start.elapsedNow().inWholeNanoseconds / 1e6,
    )
    if (baseProb >= TARGET) return done()

    val ed0 = base.expenseDelta
    val profile = base.profile

    fun findCut(input: SimInput): Cut? {
        if (search(input.copy(expenseDelta = ed0 - MAX_CUT)).successProb < TARGET) return null
        var lo = 0.0
        var hi = MAX_CUT
        repeat(8) {
            val mid = (lo + hi) / 2
            if (search(input.copy(expenseDelta = ed0 - mid)).successProb >= TARGET) hi = mid else lo = mid
        }
        var cut = ceil(hi / 10) * 10
        var prob = score(input.copy(expenseDelta = ed0 - cut)).successProb
        for (attempt in 0 until 5) {
            if (prob >= TARGET) break
            cut = ceil((cut * 1.05) / 10) * 10
            prob = score(input.copy(expenseDelta = ed0 - cut)).successProb
        }
        return Cut(cut, prob)
    }

    findCut(base)?.let { spend ->
        val daily = jsRound(spend.cut / 30)
        val detail = if (spendTip == null) message("recipe.spendDetailNoTip", "daily" to daily) else
            message("recipe.spendDetail", "daily" to daily, "tip" to spendTip)
        recipes.add(Recipe("spend", message("recipe.spendTitle", "amount" to spend.cut),
            detail, spend.prob, RecipePatch.ExpenseDelta(ed0 - spend.cut)))
    }

    if (!base.optimizeIdleCash) {
        val prob = score(base.copy(optimizeIdleCash = true)).successProb
        val idle = maxOf(0.0, profile.cash - BUFFER_MONTHS * (profile.expensesMonth + ed0))
        val taxSaving = if (profile.contributes3a) 0.0 else jsRound(PILLAR_3A_MAX * profile.marginalTaxRate)
        val title = message(if (taxSaving == 0.0) "recipe.investTitle" else "recipe.investTitle3a",
            "k" to jsRound(idle / 1000))
        val detail = if (taxSaving == 0.0) message("recipe.investDetail", "months" to BUFFER_MONTHS) else
            message("recipe.investDetail3a", "months" to BUFFER_MONTHS, "tax" to taxSaving)
        recipes.add(Recipe("invest", title, detail, prob, RecipePatch.Optimize))
    }

    val house = base.events.firstOrNull { it.type == EventType.HOUSE }
    if (house != null && baseRun.house != null && baseRun.house.boughtProb < TARGET) {
        for (delay in 6..120 step 6) {
            val shifted = base.copy(events = shiftEvent(base.events, house.id, delay))
            if ((search(shifted).house?.boughtProb ?: 0.0) < TARGET) continue
            val result = score(shifted)
            val pass = result.house?.boughtProb ?: 0.0
            if (pass < TARGET) continue
            recipes.add(Recipe("timing", message("recipe.timingTitle", "months" to delay),
                message("recipe.timingDetail", "home" to (house.labelMsg ?: house.label), "pass" to pass),
                result.successProb, RecipePatch.Delay(house.id, delay)))
            if (result.successProb < TARGET) {
                findCut(shifted)?.let { combo ->
                    recipes.add(Recipe("combo", message("recipe.comboTitle", "months" to delay, "amount" to combo.cut),
                        message("recipe.comboDetail", "pass" to pass), combo.prob,
                        RecipePatch.Combo(house.id, delay, ed0 - combo.cut)))
                }
            }
            break
        }
    }
    return done()
}

fun applyRecipe(scenario: Scenario, recipe: Recipe): Scenario = when (val patch = recipe.apply) {
    is RecipePatch.ExpenseDelta -> scenario.copy(expenseDelta = patch.value)
    RecipePatch.Optimize -> scenario.copy(optimize = true)
    is RecipePatch.Delay -> scenario.copy(events = shiftEvent(scenario.events, patch.eventId, patch.months))
    is RecipePatch.Combo -> scenario.copy(
        events = shiftEvent(scenario.events, patch.eventId, patch.months),
        expenseDelta = patch.expenseDelta,
    )
}
