package ch.doppel.pocket.twin

import ch.doppel.pocket.LocalDate
import ch.doppel.pocket.finance.EventType
import ch.doppel.pocket.finance.RiskProfile
import ch.doppel.pocket.normalizeUnicode

private const val PER_MONTH = """(?:par|chaque|\/)\s*mois|mensuel\w*|tous\s+les\s+mois|p\.\s?m\.?"""

/** Strip combining accents after NFD so accented and unaccented user input match the same patterns. */
private fun foldAccents(s: String): String {
    return normalizeUnicode(s, decomposed = true).replace(Regex("""[\u0300-\u036f]"""), "")
}

private fun monthFrom(t: String, now: LocalDate): Int? {
    val y = yearIn(t)
    if (y != null) return monthOfYear(y, now)
    val inYears = t.match(Regex("""\bdans\s+(\d+)\s+ans?\b"""))
    if (inYears != null) return months(inYears.count(1), years = true)
    if (Regex("""\bdans\s+un\s+an\b""").containsMatchIn(t)) return 12
    val inMonths = t.match(Regex("""\bdans\s+(\d+)\s+mois\b"""))
    if (inMonths != null) return inMonths.count(1)
    if (Regex("""(?:l'an|l'annee)\s+prochaine?|\ban\s+prochain\b|\bannee\s+prochaine\b""").containsMatchIn(t)) return 12
    return null
}

internal fun parseFrench(ctx: IntentContext): List<Op> {
    val (text, house, now) = ctx
    val normalized = normalizeText(text, Language.FR)
        .replace(Regex("""(\d),[-–—]{1,2}"""), "$1")
        .replace(Regex("""(?<![\p{L}])fr\.?(?![\p{L}])"""), " ")
        .replace(Regex("""\s+"""), " ")
        .trim()
    val t = foldAccents(normalized)

    val eventMonth = monthFrom(t, now)
    val ops = mutableListOf<Op>()

    // prendre ma retraite à 60 ans / retraite anticipée à 62 ans / partir à la retraite à 60 / à 63 ans à la retraite
    val retire =
        t.match(Regex("""(?:retraite|retraite\s+anticipee|pension|(?:arret|cess)\w*\s+de\s+travailler)\D{0,30}?(?<!\p{L})(?:a|des|vers)\s+(?<!\d)(\d{2})(?!\d)(?:\s*ans)?\b""")) ?:
        t.match(Regex("""(?<!\p{L})(?:a|des|vers)\s+(?<!\d)(\d{2})(?!\d)\s*ans\D{0,25}?(?:retraite|pension|(?:arret|cess)\w*\s+de\s+travailler)"""))
    if (retire != null) ops.add(Op.SetNumber(NumericSetting.RETIREMENT_AGE, retire.count(1).toDouble()))

    // investir 500 par mois / j'investis 1'200 par mois / placer 300 chaque mois / ordre permanent de 500 par mois
    if (Regex("""(?:^|[\s'])(?:invest|plac|ordre\s+permanent|plan\s+d'epargne|virement\s+permanent)""").containsMatchIn(t)) {
        val m =
            t.match(Regex("""$AMOUNT\s*(?:(?:de\s+|supplementaire\w*\s+|en\s+plus\s+)?(?:$PER_MONTH))""")) ?:
            t.match(Regex("""(?:$PER_MONTH)\s+(?:(?:j')?invest\w*\s+|plac\w*\s+|de\s+|d')?$AMOUNT"""))
        if (m != null) ops.add(Op.SetNumber(NumericSetting.MONTHLY_INVEST, amountValue(m[1], m[2])))
        else if (Regex("""(liquidites?|cash|argent\s+(?:qui\s+dort|inactif|dormant)|epargne\s+(?:inutilisee|dormante|qui\s+dort))""").containsMatchIn(t))
            ops.add(Op.SetFlag(FlagSetting.OPTIMIZE, true))
    } else if (Regex("""faire\s+travailler\s+(?:mon\s+|l'|mes\s+)?(?:argent|cash|epargne|liquidites?)""").containsMatchIn(t)) {
        ops.add(Op.SetFlag(FlagSetting.OPTIMIZE, true))
    }

    // passer au profil croissance / profil prudent / stratégie équilibrée / portefeuille dynamique
    if (Regex("""(profil|strategie|portefeuille|passer|passe\b|changer|change\b|adopter|invest|plac|risque|plus|moins|devenir|opter|basculer|mode)""").containsMatchIn(t)) {
        val w = t.match(Regex("""(conservat|defensi|prudent|plus\s+sur|securitaire|moins\s+de\s+risque|equilibr|balanc|moder|croissance|dynamique|agressi|offensi|audacieux)"""))
        if (w != null) {
            val value = when {
                Regex("""equilibr|balanc|moder""").containsMatchIn(w[1]) -> RiskProfile.BALANCED
                Regex("""croissance|dynamique|agressi|offensi|audacieux""").containsMatchIn(w[1]) -> RiskProfile.GROWTH
                else -> RiskProfile.CONSERVATIVE
            }
            ops.add(Op.SetRisk(value))
        }
    }

    // réduire mes dépenses de 400 / dépenser 400 de moins par mois / j'économise 400 / baisser mon budget de 400
    val cut =
        t.match(Regex("""(?<!d')(?:redui\w*|baiss\w*|diminu\w*|coup\w*|economis\w*|comprim\w*)\s+(?:mes\s+|les\s+|nos\s+|mon\s+|le\s+|notre\s+)?(?:depenses?\s+|couts?\s+|frais\s+|charges?\s+|budget\s+|train\s+de\s+vie\s+)?(?:de\s+|d')?$AMOUNT""")) ?:
        t.match(Regex("""depenser\s+$AMOUNT\s*(?:(?:$PER_MONTH)\s*)?(?:de\s+|en\s+)?moins""")) ?:
        t.match(Regex("""depenser\s+(?:de\s+|en\s+)?moins\s+(?:de\s+|d')?$AMOUNT""")) ?:
        t.match(Regex("""$AMOUNT\s*(?:(?:$PER_MONTH)\s*)?(?:de\s+|en\s+)?moins\s+(?:de\s+|en\s+)?(?:depenses?|frais|charges?)"""))
    val more = t.match(Regex("""depenser\s+$AMOUNT\s*(?:(?:$PER_MONTH)\s*)?(?:de\s+|en\s+)?plus"""))
    if (cut != null) ops.add(Op.SetNumber(NumericSetting.EXPENSE_DELTA, -amountValue(cut[1], cut[2])))
    else if (more != null) ops.add(Op.SetNumber(NumericSetting.EXPENSE_DELTA, amountValue(more[1], more[2])))

    // maximiser le 3a / commencer le pilier 3a / ouvrir un 3e pilier / arrêter le 3a
    if (Regex("""\b3a\b|pilier\s*3|3e\s+pilier|3eme\s+pilier|troisieme\s+pilier""").containsMatchIn(t)) {
        if (Regex("""(arret|stop|suspend|plus\s+(?:de\s+|cotiser\s+au\s+)?(?:pilier\s*)?3|ne\s+plus|desactiv|coup|abandonn|sans\s+(?:pilier\s*)?3)""").containsMatchIn(t))
            ops.add(Op.SetFlag(FlagSetting.CONTRIBUTES_3A, false))
        else if (Regex("""(maxim|max\b|plafonn|commenc|debut|ouvr|vers|cotis|utilis|rempli|plein|activ|aliment|mett)""").containsMatchIn(t))
            ops.add(Op.SetFlag(FlagSetting.CONTRIBUTES_3A, true))
    }

    // repousser l'achat de 2 ans / reporter l'appartement de 6 mois / décaler l'achat du logement de 6 mois / acheter 6 mois plus tard
    val delay =
        t.match(Regex("""(?:repouss|report|retard|decal|differ|attend)\S*\D{0,45}?(\d+)\s*(ans?|annees?|mois)\b""")) ?:
        t.match(Regex("""(?:achet\w*|achat|appart\w*|maison|logement|immobilier)\D{0,30}?(\d+)\s*(ans?|annees?|mois)\s+plus\s+tard\b"""))
    if (delay != null && house != null) ops.add(Op.Shift(house.id, months(delay.count(1), years = delay[2] != "mois")))

    // acheter un appartement à Lausanne pour 1,2 mio / acheter une maison pour 1,2 million en 2028
    if (Regex("""(?:^|[\s'])(?:achet|achat|acquerir|acquisition)""").containsMatchIn(t) && Regex("""(maison|appartement|appart\b|logement|bien|propriete|villa|studio|duplex|chalet)""").containsMatchIn(t)) {
        val price = largestAmountAbove(t, 50_000.0)
        if (price != null) {
            val where = text.match(Regex("""(?<!\p{L})(?:à|a|en)\s+(?!(?:CHF|SFr|Fr|Mio|Millions?)\b)([A-ZÄÖÜÉÈÀÂÎÏÔÙÛÇ][\p{L}-]+)"""))
            ops.add(homeEvent(where?.get(1), eventMonth ?: house?.month ?: 24, price))
        }
    }

    // perdre mon emploi / perte d'emploi / chômage / licencié / tomber au chômage
    if (Regex("""(perd|perte)\S*\s+(?:de\s+|d'|mon\s+|ma\s+|son\s+|sa\s+|notre\s+|l'|un\s+)?(?:emploi|travail|job|poste|place|boulot)|chomage|licenci|sans\s+emploi|sans\s+travail""").containsMatchIn(t)) {
        val dur = t.match(Regex("""(\d+)\s*mois"""))
        ops.add(event(EventType.JOBLOSS, "event.jobLoss", eventMonth ?: 12, 0.0, dur?.count(1) ?: 6))
    }

    // krach boursier / effondrement des marchés / chute de la bourse / récession
    if (Regex("""krach|crash|effondrement|chute\s+(?:des\s+marches|de\s+la\s+bourse|boursiere)|baisse\s+(?:des\s+marches|de\s+la\s+bourse)|crise\s+boursiere|recession""").containsMatchIn(t)) {
        ops.add(event(EventType.CRASH, "event.crash", eventMonth ?: 12, 0.0))
    }

    // un bébé / un enfant / naissance
    if (Regex("""\b(bebe|enfant|naissance|enceinte)\b""").containsMatchIn(t)) {
        ops.add(event(EventType.CHILD, "event.baby", eventMonth ?: 18, 1500.0, 216))
    }

    // augmentation de 10k
    val raise = t.match(Regex("""(augmentation|promotion|hausse\s+de\s+salaire)\D{0,25}$AMOUNT"""))
    if (raise != null) ops.add(event(EventType.RAISE, "event.raise", eventMonth ?: 6, amountValue(raise[2], raise[3])))

    return ops
}
