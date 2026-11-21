package ch.doppel.pocket.twin

import ch.doppel.pocket.LocalDate
import ch.doppel.pocket.finance.EventType
import ch.doppel.pocket.finance.RiskProfile

private const val PER_MONTH = """(?:(?:pro|im|jeden|je|\/)\s*(?:monat|mt\.?)|monatlich|mtl\.?|p\.\s?m\.?)(?![\p{L}])"""
private const val PENSION = """(?:(?:früh)?pension\p{L}*|rente|ruhestand|aufhören\s+zu\s+arbeiten)"""
private const val AGE = """\b(?:mit|ab|bei)\s+(\d{2})\b(?:\s+jahren)?"""
private const val SPENDING = "ausgaben|kosten|budget"
private const val CUT = "senk|kürz|reduzier|verringer|tiefersetz"
private const val DELAY = "verschieb|aufschieb|hinausschieb|hinauszöger|hinauszieh|nach hinten|zuwart|wart"
private val HOME = Regex("""haus|wohnung|eigenheim|immobilie|wohneigentum|eigentum|liegenschaft""")
private val HOME_PRICE = Regex("""\b(?:für|kaufpreis(?:\s+von)?)\s+$AMOUNT""")
private val JOB_LOSS = Regex("""(?:job|stelle|arbeit|anstellung)\S*(?:\s+\S+){0,7}?\s+(?:verlier|verloren)|(?:verlier|verloren)\S*(?:\s+\S+){0,5}?\s+(?:job|stelle|arbeit|anstellung)\b|jobverlust|arbeitslos|stellenverlust|stellenlos|kündigung|gekündigt|entlassen|entlassung""")
private const val MARKET = """\b(?:börse|markt|märkte|aktienkurse)\b"""
private val MARKET_FALLS = Regex("""${MARKET}[^.!?]{0,50}?\b(?:stürz|einbr|kollabier|krach|br(?:icht|echen)\b[^.!?]{0,30}?\bein\b)|\bbr(?:icht|echen)\b[^.!?]{0,35}?${MARKET}\s+ein\b""")

private val RISK_TERMS = linkedMapOf(
    RiskProfile.CONSERVATIVE to "konservativ|defensiv|sicherer|vorsichtig|sicherheit|weniger (?:aktien|risiko)",
    RiskProfile.BALANCED to "ausgewogen|ausgeglichen",
    RiskProfile.GROWTH to "wachstum|aggressiv|offensiv|dynamisch|risikoreicher|mehr (?:aktien|risiko)",
)
private val RISK_WORDS = RISK_TERMS.values.joinToString("|")
private val RISK_PROFILES = RISK_TERMS.mapValues { (_, terms) -> Regex("""^(?:${terms})$""") }

private fun monthFrom(t: String, now: LocalDate): Int? {
    val y = yearIn(t)
    if (y != null) return monthOfYear(y, now)
    val inYears = t.match(Regex("""\bin\s+(\d+)\s+jahr"""))
    if (inYears != null) return months(inYears.count(1), years = true)
    val inMonths = t.match(Regex("""\bin\s+(\d+)\s+monat"""))
    if (inMonths != null) return inMonths.count(1)
    if (Regex("""\b(?:nächste[ns]?|kommende[ns]?|folgende[ns]?)\s+jahr\b""").containsMatchIn(t)) return 12
    return null
}

internal fun parseGerman(ctx: IntentContext): List<Op> {
    val (text, house, now) = ctx
    val t = normalizeText(text, Language.DE)

    val eventMonth = monthFrom(t, now)
    val ops = mutableListOf<Op>()

    // «Mit 60 in Pension», «mit 62 lasse ich mich pensionieren».
    val retire =
        t.match(Regex("""${AGE}[^.!?\d]{0,40}?\b${PENSION}\b""")) ?:
        t.match(Regex("""\b${PENSION}\b[^.!?\d]{0,30}?${AGE}"""))
    if (retire != null) ops.add(Op.SetNumber(NumericSetting.RETIREMENT_AGE, retire.count(1).toDouble()))

    // The amount can appear on either side of the monthly cadence.
    if (Regex("""investier|investition|anleg|geldanlage|sparplan|dauerauftrag|\bleg\p{L}*\b[^.!?]{0,45}?\ban\b|\bin\s+(?:(?:ein\p{L}*|den)\s+)?(?:fonds|etfs?|aktien)\b""").containsMatchIn(t)) {
        val m = t.match(Regex("""$AMOUNT\s*$PER_MONTH"""))
            ?: t.match(Regex("""$PER_MONTH\s+$AMOUNT"""))
            ?: t.match(Regex("""$PER_MONTH\s+(?:\p{L}+\s+){1,4}$AMOUNT"""))
            ?: t.match(Regex("""\bdauerauftrag\s+(?:über|von)\s+$AMOUNT"""))
        if (m != null) ops.add(Op.SetNumber(NumericSetting.MONTHLY_INVEST, amountValue(m[1], m[2])))
        else if (Regex("""(freie[ns]?|überschüssige[ns]?|liegende[ns]?|ungenutzte[ns]?)\s+(geld|cash|bargeld|liquidität)|cash\s+(investieren|anlegen)""").containsMatchIn(t))
            ops.add(Op.SetFlag(FlagSetting.OPTIMIZE, true))
    } else if (Regex("""geld\s+arbeiten\s+lassen""").containsMatchIn(t)) ops.add(Op.SetFlag(FlagSetting.OPTIMIZE, true))

    // Prefer the destination in «von defensiv auf Wachstum wechseln».
    if (Regex("""risiko|strategie|portfolio|profil|wechsl|wechsel|umstell|anleg|investier|\bsei\b|werd|mehr|weniger|geh|setz""").containsMatchIn(t)) {
        val wanted = t.match(Regex("""\b(?:auf|zu)\s+(?:(?:ein\p{L}*|d(?:as|e[nmrs]|ie))\s+)?($RISK_WORDS)"""))
            ?: t.match(Regex("""\b($RISK_WORDS)"""))
        val risk = wanted?.let { match -> RISK_PROFILES.entries.firstOrNull { it.value.matches(match[1]) } }
        if (risk != null) ops.add(Op.SetRisk(risk.key))
    }

    // «Fixkosten um 400 senken», «monatlich 400 weniger ausgeben», «400 einsparen».
    val cut =
        t.match(Regex("""(?:${SPENDING})\s+(?:$PER_MONTH\s+)?(?:um\s+)?$AMOUNT\s*(?:$PER_MONTH\s*)?(?:${CUT})""")) ?:
        t.match(Regex("""(?:${CUT}|\b(?:ein)?spar)\p{L}*\s+(?:(?:ich|wir|meine|unsere|die|$PER_MONTH)\s+)*(?:\p{L}*?(?:${SPENDING})\s+)?(?:um\s+)?$AMOUNT""")) ?:
        t.match(Regex("""$AMOUNT\s*(?:$PER_MONTH\s*)?(?:weniger\s+(?:$PER_MONTH\s+)?aus(?:g[ei]b|gaben)|einspar)"""))
    val more = t.match(Regex("""$AMOUNT\s*(?:$PER_MONTH\s*)?mehr\s+(?:$PER_MONTH\s+)?aus(?:g[ei]b|gaben)"""))
    if (cut != null) ops.add(Op.SetNumber(NumericSetting.EXPENSE_DELTA, -amountValue(cut[1], cut[2])))
    else if (more != null) ops.add(Op.SetNumber(NumericSetting.EXPENSE_DELTA, amountValue(more[1], more[2])))

    if (Regex("""\b3a\b|säule\s*3|3\.\s*säule|dritte\p{L}*\s+säule""").containsMatchIn(t)) {
        if (Regex("""stopp|aufhör|pausier|aussetz|sistier|einstell|auslass|\bnicht\s+mehr|\bnicht\s+(?:einzahl|einleg|bespar)|\bkeine?\b""").containsMatchIn(t))
            ops.add(Op.SetFlag(FlagSetting.CONTRIBUTES_3A, false))
        else if (Regex("""maxim|höchstbetrag|voll|start|beginn|anfang|fang|eröffn|einzahl|einleg|nutz|ausschöpf|ausreiz|alimentier|bespar""").containsMatchIn(t))
            ops.add(Op.SetFlag(FlagSetting.CONTRIBUTES_3A, true))
    }

    // «Noch 6 Monate zuwarten», «Kauf um 2 Jahre nach hinten schieben».
    val delay =
        t.match(Regex("""(?<!in )\b(\d+)\s*(jahr|monat)\p{L}*\s+(?:später|${DELAY})""")) ?:
        t.match(Regex("""\b(?:${DELAY})\p{L}*[^.!?\d]{0,40}?(?<!in )\b(\d+)\s*(jahr|monat)""")) ?:
        t.match(Regex("""\bschieb\w*\b[^.!?\d]{0,45}?\b(\d+)\s*(jahr|monat)\w*\s+(?:auf|hinaus|nach hinten)\b"""))
    if (delay != null && house != null) ops.add(Op.Shift(house.id, months(delay.count(1), years = delay[2] == "jahr")))

    // Prefer an explicit purchase price to other amounts in the same sentence.
    if (delay == null && Regex("""kauf|erwerb""").containsMatchIn(t) && HOME.containsMatchIn(t)) {
        val priced = HOME_PRICE.findAll(t).firstOrNull { it[2].isNotEmpty() || !Regex("""20[2-6]\d""").matches(it[1]) }
        val price = priced?.let { amountValue(it[1], it[2]) } ?: largestAmountAbove(t, 50_000.0)
        if (price != null) {
            val where = text.match(Regex("""\b[Ii]n\s+((?:St\.\s+)?\p{Lu}[\p{L}’'-]+)(?<!\bJahr)\b"""))
            ops.add(homeEvent(where?.get(1), eventMonth ?: house?.month ?: 24, price))
        }
    }

    // «Stellenlos» and «ohne Stelle» are common in Switzerland.
    if (JOB_LOSS.containsMatchIn(t) || Regex("""\bohne\s+(?:job|stelle|arbeit|anstellung)\b""").containsMatchIn(t)) {
        val dur = t.match(Regex("""\bfür\s+(\d+)\s*monat"""))
            ?: t.match(Regex("""(?<!in )\b(\d+)\s*monate?(?:\s+lang)?\b"""))
        ops.add(event(EventType.JOBLOSS, "event.jobLoss", eventMonth ?: 12, 0.0, dur?.count(1) ?: 6))
    }

    if (Regex("""crash|börsen(?:einbruch|sturz)|markt(?:einbruch|absturz)|kurssturz|rezession""").containsMatchIn(t) || MARKET_FALLS.containsMatchIn(t)) {
        ops.add(event(EventType.CRASH, "event.crash", eventMonth ?: 12, 0.0))
    }

    if (Regex("""\b(?:baby|nachwuchs|familienzuwachs|schwanger)|\b(?:ein|unser\w*|zweites|drittes|erstes)\s+kind\b|\bkind\s+bekommen|\bgeburt\s+(?:eines|unseres)\s+kindes\b|\b(?:mutter|vater|eltern)\s+werd|\bwerd\w*\s+(?:ich\s+|wir\s+)?(?:mutter|vater|eltern)\b""").containsMatchIn(t)) {
        ops.add(event(EventType.CHILD, "event.baby", eventMonth ?: 18, 1500.0, 216))
    }

    val raise = t.match(Regex("""(lohnerhöhung|gehaltserhöhung|beförderung)\D{0,20}$AMOUNT"""))
    if (raise != null) ops.add(event(EventType.RAISE, "event.raise", eventMonth ?: 6, amountValue(raise[2], raise[3])))

    return ops
}
