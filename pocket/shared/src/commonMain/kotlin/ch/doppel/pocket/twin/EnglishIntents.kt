package ch.doppel.pocket.twin

import ch.doppel.pocket.LocalDate
import ch.doppel.pocket.finance.EventType
import ch.doppel.pocket.finance.RiskProfile

private const val NUM = """(\d+(?:[.,']\d+)*)\s*(k|mio|million|thousand|m)?\b"""

private fun money(n: String, unit: String): Double {
    val v = n.replace(Regex("""['’]"""), "").replace(",", ".").toDoubleOrNull() ?: return Double.NaN
    val u = unit.lowercase()
    if (u == "k" || u == "thousand") return v * 1000
    if (u == "m" || u == "mio" || u == "million") return v * 1_000_000
    return v
}

private fun monthFrom(text: String, nowYear: Int, nowMonth: Int): Int? {
    val y = text.match(Regex("""\b(20[2-6]\d)\b"""))
    if (y != null) return monthOfYear(y.count(1), LocalDate(nowYear, nowMonth))
    val inYears = text.match(Regex("""in\s+(\d+)\s+years?""", RegexOption.IGNORE_CASE))
    if (inYears != null) return months(inYears.count(1), years = true)
    val inMonths = text.match(Regex("""in\s+(\d+)\s+months?""", RegexOption.IGNORE_CASE))
    if (inMonths != null) return inMonths.count(1)
    if (Regex("""next year""", RegexOption.IGNORE_CASE).containsMatchIn(text)) return 12
    return null
}

private const val PER_MONTH = """(?:a|per|each|every|\/|in\s+a)\s*month|monthly|\/\s*mo\b|p\.?\s?m\.?"""

internal fun parseEnglish(ctx: IntentContext): List<Op> {
    val (text, house, now) = ctx
    val t = text.lowercase().replace(Regex("""chf\s*"""), "").replace(Regex("""(\d)['’](\d)"""), "$1$2")
    val nowYear = now.year
    val nowMonth = now.month

    val eventMonth = monthFrom(t, nowYear, nowMonth)
    val ops = mutableListOf<Op>()

    // retire at 60 / retire early at 62
    val retire = t.match(Regex("""retir\w*\s+(?:early\s+)?(?:at|by|when\s+i(?:'|’)?m)\s+(?:age\s+)?(\d{2})\b"""))
    if (retire != null) ops.add(Op.SetNumber(NumericSetting.RETIREMENT_AGE, retire.count(1).toDouble()))

    // start investing 500 a month / invest 500 per month
    val invest = t.match(Regex("""invest\w*\s+(?:an?\s+extra\s+)?$NUM\s*(?:$PER_MONTH)"""))
    if (invest != null) ops.add(Op.SetNumber(NumericSetting.MONTHLY_INVEST, money(invest[1], invest[2])))
    else if (Regex("""(invest|put)\s+(my\s+|the\s+)?(idle\s+)?cash\s+(to\s+work|in)|invest\s+(my\s+|the\s+)?idle""").containsMatchIn(t))
        ops.add(Op.SetFlag(FlagSetting.OPTIMIZE, true))

    // switch to growth / go conservative / more aggressive
    val risk = t.match(Regex("""\b(switch|change|move|go|be|invest|rebalance|make\s+it|more)\b[^.]{0,25}?\b(conservative|defensive|safer|balanced|growth|aggressive)\b"""))
    if (risk != null) {
        val w = risk[2]
        val value = when (w) {
            "balanced" -> RiskProfile.BALANCED
            "growth", "aggressive" -> RiskProfile.GROWTH
            else -> RiskProfile.CONSERVATIVE
        }
        ops.add(Op.SetRisk(value))
    }

    // cut spending by 400 / spend 400 less / reduce expenses by 400
    val cut =
        t.match(Regex("""(?:cut|reduce|lower|trim|save)\s+(?:my\s+)?(?:spending|expenses|costs|budget)?\s*(?:by\s+)?$NUM""")) ?:
        t.match(Regex("""spend\s+$NUM\s+less"""))
    val more = t.match(Regex("""spend\s+$NUM\s+more"""))
    if (cut != null) ops.add(Op.SetNumber(NumericSetting.EXPENSE_DELTA, -money(cut[1], cut[2])))
    else if (more != null) ops.add(Op.SetNumber(NumericSetting.EXPENSE_DELTA, money(more[1], more[2])))

    // max out 3a / start 3a / stop 3a
    if (Regex("""\b3a\b""").containsMatchIn(t) || Regex("""pillar\s*3""").containsMatchIn(t)) {
        if (Regex("""(stop|pause|quit|no longer)\b[^.]{0,20}(3a|pillar)""").containsMatchIn(t)) ops.add(Op.SetFlag(FlagSetting.CONTRIBUTES_3A, false))
        else if (Regex("""(max|start|open|begin|pay\s+into|contribute|use)""").containsMatchIn(t)) ops.add(Op.SetFlag(FlagSetting.CONTRIBUTES_3A, true))
    }

    // delay / postpone the house
    val delay = t.match(Regex("""(delay|postpone|push|wait)\D{0,30}?(\d+)\s*(years?|months?)"""))
    if (delay != null && house != null) {
        val n = months(delay.count(2), years = delay[3].startsWith("year"))
        ops.add(Op.Shift(house.id, n))
    }

    // buy a house/flat for X
    val buy = t.match(Regex("""(buy|purchase)\b[^\d]{0,40}?$NUM"""))
    if (buy != null && Regex("""(house|home|flat|apartment|condo)""").containsMatchIn(t)) {
        val price = money(buy[2], buy[3])
        if (price > 50_000) {
            val where = text.match(Regex("""\bin\s+([A-ZÄÖÜ][\wäöüé-]+)"""))
            ops.add(homeEvent(where?.get(1), eventMonth ?: house?.month ?: 24, price))
        }
    }

    // job loss
    val job = t.match(Regex("""(lose|lost|losing)\s+(my\s+)?job|unemploy|laid off"""))
    if (job != null) {
        val dur = t.match(Regex("""(\d+)\s*months?"""))
        ops.add(event(EventType.JOBLOSS, "event.jobLoss", eventMonth ?: 12, 0.0, dur?.count(1) ?: 6))
    }

    // market crash
    if (Regex("""crash|market\s+(drops?|falls?|tanks?)|recession""").containsMatchIn(t)) {
        ops.add(event(EventType.CRASH, "event.crash", eventMonth ?: 12, 0.0))
    }

    // child
    if (Regex("""\b(baby|child|kid)\b""").containsMatchIn(t)) {
        ops.add(event(EventType.CHILD, "event.baby", eventMonth ?: 18, 1500.0, 216))
    }

    // raise
    val raise = t.match(Regex("""(raise|promotion|salary increase)[^\d]{0,20}$NUM"""))
    if (raise != null) {
        ops.add(event(EventType.RAISE, "event.raise", eventMonth ?: 6, money(raise[2], raise[3])))
    }

    return ops
}
