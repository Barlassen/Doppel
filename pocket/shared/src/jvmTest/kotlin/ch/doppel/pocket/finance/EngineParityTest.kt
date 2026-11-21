package ch.doppel.pocket.finance

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EngineParityTest {
    private var maxDeviation = 0.0
    private var worstPath = ""
    private var comparedNumbers = 0

    @Test
    fun matchesTypeScript() {
        val source = checkNotNull(javaClass.getResource("/engine-golden.json")).readText()
        val expected = Json.parseToJsonElement(source).jsonObject
        for (sample in expected.getValue("rng").jsonArray) {
            val row = sample.jsonObject
            val seed = row.getValue("seed").jsonPrimitive.int
            val draw = mulberry32(seed)
            for ((index, value) in row.getValue("values").jsonArray.withIndex()) {
                assertEquals(value.jsonPrimitive.double, draw(), "PRNG seed $seed, draw $index")
                comparedNumbers++
            }
        }

        for (sample in expected.getValue("scenarios").jsonArray) {
            val row = sample.jsonObject
            val id = row.getValue("id").jsonPrimitive.content
            val paths = row.getValue("paths").jsonPrimitive.int
            val seed = row.getValue("seed").jsonPrimitive.int
            val (profile, scenario) = scenario(id)
            val params = analyzeBehavior(effectiveProfile(profile, scenario), scenario.extraTx)
            val idealInput = simInputFor(profile, scenario).copy(paths = paths, seed = seed)
            val realInput = idealInput.copy(behavior = params.params)
            val ideal = simulate(idealInput)
            val real = simulate(realInput)
            val solver = solveGoal(realInput, params.spendTip)

            verify("$id.ideal", row.getValue("ideal"), ideal.values())
            verify("$id.real", row.getValue("real"), real.values())
            assertEquals((profile.age..90).toList(), real.bands.map { it.age }, "$id full horizon")
            assertEquals(real.bands.first().year + 1, real.bands[1].year)
            verify("$id.affordability", row.getValue("affordability"), real.house?.affordability()?.values())
            verify("$id.behavior", row.getValue("behavior"), mapOf(
                "leakageRate" to params.params.leakageRate,
                "panicSellProb" to params.params.panicSellProb,
                "panicSellShare" to params.params.panicSellShare,
                "panicOutMonths" to params.params.panicOutMonths,
            ))
            verify("$id.habits", row.getValue("habits"), habitCosts(realInput)?.let {
                mapOf("leakagePp" to it.leakagePp, "panicPp" to it.panicPp)
            })
            verify("$id.waiting", row["waiting"] ?: JsonNull, costOfWaiting(realInput)?.map {
                mapOf("startMonth" to it.startMonth, "prob" to it.prob)
            })
            verify("$id.baseProb", row.getValue("baseProb"), solver.baseProb)
            verify("$id.recipes", row.getValue("recipes"), solver.recipes.map { recipe ->
                val next = applyRecipe(scenario, recipe)
                val behavior = analyzeBehavior(effectiveProfile(profile, next), next.extraTx)
                val appliedProb = simulate(simInputFor(profile, next, behavior.params)).successProb
                assertEquals(recipe.newProb, appliedProb, "$id ${recipe.id} must land on its advertised probability")
                mapOf("id" to recipe.id, "newProb" to recipe.newProb, "reaches" to recipe.reaches,
                    "apply" to recipe.apply.values(), "appliedProb" to appliedProb)
            })
        }
        println("Compared $comparedNumbers numbers against TypeScript. Max absolute deviation: $maxDeviation ($worstPath)")
    }

    private fun verify(path: String, expected: JsonElement, actual: Any?) {
        when (actual) {
            null -> assertEquals(JsonNull, expected, path)
            is Number -> {
                val target = expected.jsonPrimitive.double
                val deviation = abs(actual.toDouble() - target)
                val tolerance = if (actual is Int || path.endsWith("Prob")) 0.0 else 1e-7
                assertTrue(deviation <= tolerance, "$path expected $target, got $actual (delta $deviation)")
                comparedNumbers++
                if (deviation > maxDeviation) {
                    maxDeviation = deviation
                    worstPath = path
                }
            }
            is String, is Boolean -> assertEquals(expected.jsonPrimitive.content, actual.toString(), path)
            is Map<*, *> -> {
                val expectedObject = expected as JsonObject
                assertEquals(expectedObject.keys, actual.keys, path)
                for ((key, value) in expectedObject) verify("$path.$key", value, actual[key])
            }
            is List<*> -> {
                val expectedArray = expected as JsonArray
                assertEquals(expectedArray.size, actual.size, path)
                for ((i, value) in expectedArray.withIndex()) verify("$path[$i]", value, actual[i])
            }
            else -> error("Unsupported parity value for $path")
        }
    }

    private fun scenario(id: String): Pair<Profile, Scenario> {
        val (lukas, elena) = profiles
        val base = baseScenario(lukas)
        return when (id) {
            "lukas" -> lukas to base
            "elena" -> elena to baseScenario(elena)
            "lukas_listing" -> lukas to base.copy(events = listOf(lukas.events.single().copy(amount = 940_000.0)))
            "elena_retire_62" -> elena to baseScenario(elena).copy(retirementAge = 62)
            "lukas_stress" -> lukas to base.copy(
                monthlyInvest = 500.0,
                expenseDelta = -400.0,
                optimize = true,
                events = base.events + listOf(
                    LifeEvent("job", EventType.JOBLOSS, "Job loss", 16, 0.0, 6),
                    LifeEvent("crash", EventType.CRASH, "Crash", 36, 0.0),
                    LifeEvent("raise", EventType.RAISE, "Raise", 48, 10_000.0),
                    LifeEvent("child", EventType.CHILD, "Child", 60, 1_500.0),
                    LifeEvent("income", EventType.INCOME, "Income", 72, 20_000.0),
                ),
            )
            else -> error("Unknown fixture scenario $id")
        }
    }

    private fun SimResult.values(): Map<String, Any?> = buildMap {
        put("bands", bands.map { mapOf("age" to it.age, "p10" to it.p10, "p50" to it.p50, "p90" to it.p90) })
        put("successProb", successProb)
        put("crunchProb", crunchProb)
        put("medianAtGoal", medianAtGoal)
        put("goalMonth", goalMonth)
        put("retirementAge", retirementAge)
        put("paths", paths)
        house?.let {
            put("house", mapOf(
                "eventId" to it.eventId, "price" to it.price, "month" to it.month, "boughtProb" to it.boughtProb,
                "medianHardEquity" to it.medianHardEquity, "medianPillar2" to it.medianPillar2,
                "grossAtPurchase" to it.grossAtPurchase, "closingRate" to it.closingRate,
                "medianEquityAtPurchase" to it.medianEquityAtPurchase, "medianLoan" to it.medianLoan,
            ))
        }
        retirement?.let {
            put("retirement", mapOf(
                "age" to it.age, "lastsTo90Prob" to it.lastsTo90Prob, "depletionAgeP10" to it.depletionAgeP10,
                "replacementRatio" to it.replacementRatio, "monthlyIncomeAtRetirement" to it.monthlyIncomeAtRetirement,
                "ahvMonthly" to it.ahvMonthly, "bvgMonthly" to it.bvgMonthly, "monthlySpending" to it.monthlySpending,
                "medianLiquidAtRetirement" to it.medianLiquidAtRetirement, "bridgeYears" to it.bridgeYears,
            ))
        }
    }

    private fun AffordabilityResult.values() = mapOf(
        "pass" to plan.pass, "hardUsed" to plan.hardUsed, "pillar2Used" to plan.pillar2Used, "equity" to plan.equity,
        "loan" to plan.loan, "closingCosts" to plan.closingCosts, "yearlyCost" to mapOf(
            "interest" to plan.yearlyCost.interest, "maintenance" to plan.yearlyCost.maintenance,
            "amortisation" to plan.yearlyCost.amortisation, "total" to plan.yearlyCost.total,
        ),
        "costToIncome" to plan.costToIncome, "equityGap" to plan.equityGap, "incomeGap" to plan.incomeGap,
        "extraEquityToPass" to plan.extraEquityToPass, "price" to price, "equityNeeded" to equityNeeded,
        "hardEquityNeeded" to hardEquityNeeded, "equityUsed" to equityUsed, "hardEquityUsed" to hardEquityUsed, "maxPrice" to maxPrice,
    )

    private fun RecipePatch.values(): Map<String, Any> = when (this) {
        is RecipePatch.ExpenseDelta -> mapOf("kind" to "expenseDelta", "value" to value)
        RecipePatch.Optimize -> mapOf("kind" to "optimize")
        is RecipePatch.Delay -> mapOf("kind" to "delay", "eventId" to eventId, "months" to months)
        is RecipePatch.Combo -> mapOf("kind" to "combo", "eventId" to eventId, "months" to months, "expenseDelta" to expenseDelta)
    }
}
