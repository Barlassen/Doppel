package ch.doppel.pocket.twin

import ch.doppel.pocket.LocalDate
import ch.doppel.pocket.finance.*
import ch.doppel.pocket.localToday

enum class Language(val tag: String) { EN("en"), DE("de"), FR("fr"), TR("tr") }

enum class NumericSetting { RETIREMENT_AGE, MONTHLY_INVEST, EXPENSE_DELTA }
enum class FlagSetting { CONTRIBUTES_3A, OPTIMIZE }

sealed interface Op {
    data class Add(
        val type: EventType,
        val label: String,
        val month: Int,
        val amount: Double,
        val duration: Int? = null,
        val labelMsg: Message? = null,
    ) : Op
    data class Shift(val id: String, val months: Int) : Op
    data class Remove(val id: String) : Op
    data class SetNumber(val key: NumericSetting, val value: Double) : Op
    data class SetFlag(val key: FlagSetting, val value: Boolean) : Op
    data class SetRisk(val risk: RiskProfile) : Op
}

private val expenseBounds = -20_000.0..20_000.0

/** Rejects out-of-range ops before any change is applied. */
fun validateOps(ops: List<Op>, events: List<LifeEvent>): List<Op> {
    val ids = events.map { it.id }.toSet()
    return ops.mapNotNull { op ->
        when (op) {
            is Op.Add -> validateAdd(op)
            is Op.Remove -> op.takeIf { it.id in ids }
            is Op.Shift -> op.takeIf { it.id in ids && it.months in -480..480 && it.months != 0 }
            is Op.SetNumber -> {
                val range = when (op.key) {
                    NumericSetting.RETIREMENT_AGE -> 55.0..70.0
                    NumericSetting.MONTHLY_INVEST -> 0.0..50_000.0
                    NumericSetting.EXPENSE_DELTA -> expenseBounds
                }
                op.takeIf { it.value in range }?.copy(value = jsRound(op.value))
            }
            is Op.SetFlag, is Op.SetRisk -> op
        }
    }
}

private fun validateAdd(op: Op.Add): Op.Add? {
    if (op.month !in 0..480 || !op.amount.isFinite() || (op.duration != null && op.duration !in 1..480)) return null
    val label = op.label.trim().take(60).ifEmpty { op.type.name.lowercase() }
    return when (op.type) {
        EventType.HOUSE -> op.takeIf { it.amount in 50_000.0..20_000_000.0 }?.copy(label = label)
        EventType.CHILD -> op.takeIf { it.amount in 0.0..10_000.0 }?.copy(
            label = label, amount = if (op.amount == 0.0) 1_500.0 else op.amount, duration = op.duration ?: 216,
        )
        EventType.JOBLOSS -> op.copy(label = label, amount = 0.0, duration = op.duration ?: 6)
        EventType.CRASH -> op.copy(label = label, amount = 0.0)
        EventType.RAISE -> op.takeIf { it.amount in -200_000.0..500_000.0 && it.amount != 0.0 }?.copy(label = label)
        EventType.EXPENSE, EventType.INCOME -> op.takeIf { it.amount in 1.0..20_000_000.0 }?.copy(label = label)
    }
}

fun localParseCommand(
    text: String,
    events: List<LifeEvent>,
    now: LocalDate = localToday(),
    language: Language = Language.EN,
): List<Op> {
    val ctx = IntentContext(text, events.firstOrNull { it.type == EventType.HOUSE }, now)
    for (locale in listOf(language) + Language.entries.filter { it != language }) {
        val result = when (locale) {
            Language.EN -> parseEnglish(ctx)
            Language.DE -> parseGerman(ctx)
            Language.FR -> parseFrench(ctx)
            Language.TR -> parseTurkish(ctx)
        }
        val valid = validateOps(result, events)
        if (valid.isNotEmpty()) return valid
    }
    return emptyList()
}

fun applyScenarioOps(scenario: Scenario, ops: List<Op>, source: EventSource = EventSource.COMMAND): Scenario {
    var next = scenario
    var id = 0
    val usedIds = scenario.events.map { it.id }.toMutableSet()
    for (op in ops) {
        next = when (op) {
            is Op.Add -> {
                val events = if (op.type == EventType.HOUSE) next.events.filter { it.type != EventType.HOUSE } else next.events
                while (!usedIds.add("ev-pocket-$id")) id++
                next.copy(events = events + LifeEvent("ev-pocket-$id", op.type, op.label,
                    op.month, op.amount, op.duration, source, op.labelMsg))
            }
            is Op.Remove -> next.copy(events = next.events.filter { it.id != op.id })
            is Op.Shift -> next.copy(events = shiftEvent(next.events, op.id, op.months))
            is Op.SetRisk -> next.copy(riskProfile = op.risk)
            is Op.SetFlag -> when (op.key) {
                FlagSetting.CONTRIBUTES_3A -> next.copy(contributes3a = op.value)
                FlagSetting.OPTIMIZE -> next.copy(optimize = op.value)
            }
            is Op.SetNumber -> when (op.key) {
                NumericSetting.RETIREMENT_AGE -> next.copy(retirementAge = op.value.toInt())
                NumericSetting.MONTHLY_INVEST -> next.copy(monthlyInvest = op.value)
                NumericSetting.EXPENSE_DELTA -> next.copy(expenseDelta = (next.expenseDelta + op.value).coerceIn(expenseBounds))
            }
        }
    }
    return next
}

fun describeOp(op: Op): Message = when (op) {
    is Op.Add -> message("ops.add", "label" to (op.labelMsg ?: op.label))
    is Op.Shift -> message("ops.shift", "months" to op.months)
    is Op.Remove -> message("ops.remove")
    is Op.SetRisk -> message("ops.riskProfile", "value" to message("risk.${op.risk.name.lowercase()}"))
    is Op.SetNumber -> message(
        when (op.key) {
            NumericSetting.RETIREMENT_AGE -> "ops.retirementAge"
            NumericSetting.MONTHLY_INVEST -> "ops.monthlyInvest"
            NumericSetting.EXPENSE_DELTA -> "ops.expenseDelta"
        },
        "value" to op.value,
    )
    is Op.SetFlag -> when (op.key) {
        FlagSetting.CONTRIBUTES_3A -> message(if (op.value) "ops.contributes3aOn" else "ops.contributes3aOff")
        FlagSetting.OPTIMIZE -> message(if (op.value) "ops.optimizeOn" else "ops.optimizeOff")
    }
}
