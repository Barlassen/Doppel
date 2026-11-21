package ch.doppel.pocket.twin

import ch.doppel.pocket.LocalDate
import ch.doppel.pocket.finance.EventType
import ch.doppel.pocket.finance.RiskProfile

private const val PER_MONTH = """ayda|aylık|aylik|her\s+ay|ay\s+başı|\/\s*ay(?!\p{L})"""

/** Drops Turkish case suffixes after numbers: "2028'de" → "2028", "500'ü" → "500", "2028de" → "2028". */
private fun stripNumberSuffixes(t: String): String {
    return t
        .replace(Regex("""(\d)'\p{L}+"""), "$1")
        .replace(Regex("""(\d{4})(?:'?(?:de|da|te|ta|den|dan|ten|tan|e|a|ye|ya))(?!\p{L})"""), "$1")
}

private fun monthFrom(t: String, now: LocalDate): Int? {
    val y = yearIn(t)
    if (y != null) return monthOfYear(y, now)
    val inYears = t.match(Regex("""(\d+)\s*(?:yıl|yil|sene)\s+(?:sonra|içinde|icinde)"""))
    if (inYears != null) return months(inYears.count(1), years = true)
    val inMonths = t.match(Regex("""(\d+)\s*ay\s+(?:sonra|içinde|icinde)"""))
    if (inMonths != null) return inMonths.count(1)
    if (Regex("""(gelecek|önümüzdeki|onumuzdeki)\s+(yıl|yil|sene)|seneye""").containsMatchIn(t)) return 12
    return null
}

internal fun parseTurkish(ctx: IntentContext): List<Op> {
    val (text, house, now) = ctx
    val t = stripNumberSuffixes(normalizeText(text, Language.TR))
        .replace(Regex("""(\d\s*)(bin|milyon)(?:a|e|u|i|dan|den|la|le)(?!\p{L})"""), "$1$2")

    val eventMonth = monthFrom(t, now)
    val ops = mutableListOf<Op>()

    // 60 yaşında emekli ol / emekliliği 62 yaşına çek / 63'te emekli olmak
    val retire =
        t.match(Regex("""(?<!\d)(\d{2})\s*(?:ya[sş]\p{L}*\s*)?(?:da|de|ta|te)?\s+emekli""")) ?:
        t.match(Regex("""emekli\p{L}*\s+(?:\p{L}+\s+){0,2}?(\d{2})\s*ya[sş]"""))
    if (retire != null) ops.add(Op.SetNumber(NumericSetting.RETIREMENT_AGE, retire.count(1).toDouble()))

    // ayda 500 yatırım yap / her ay 300 yatır / aylık 500 düzenli yatırım
    if (Regex("""yat[ıi]r|biriktir|düzenli\s+talimat""").containsMatchIn(t) || Regex("""^ayda\s+$AMOUNT[.!?]?$""").containsMatchIn(t)) {
        val m = t.match(Regex("""(?:$PER_MONTH)\s+$AMOUNT""")) ?: t.match(Regex("""$AMOUNT\s*(?:\p{L}+\s+)?(?:$PER_MONTH)"""))
        if (m != null) ops.add(Op.SetNumber(NumericSetting.MONTHLY_INVEST, amountValue(m[1], m[2])))
        else if (Regex("""(atıl|boşta|bosta|kenarda|nakit)""").containsMatchIn(t)) ops.add(Op.SetFlag(FlagSetting.OPTIMIZE, true))
    }

    // büyüme profiline geç / muhafazakar ol / dengeli portföy
    if (Regex("""(profil|strateji|portföy|portfoy|geç|gec|değiştir|degistir|yat[ıi]r|risk|daha|ol(?!\p{L}))""").containsMatchIn(t)) {
        val w = t.match(Regex("""(muhafazak[aâ]r|temkinli|ihtiyatl[ıi]|güvenli|defansif|dengeli|büyüme|buyume|agresif|atak|riskli)"""))
        if (w != null) {
            val value = when {
                Regex("""dengeli""").containsMatchIn(w[1]) -> RiskProfile.BALANCED
                Regex("""büyüme|buyume|agresif|atak|riskli""").containsMatchIn(w[1]) -> RiskProfile.GROWTH
                else -> RiskProfile.CONSERVATIVE
            }
            ops.add(Op.SetRisk(value))
        }
    }

    // harcamaları ayda 400 azalt / ayda 400 daha az harca / 200 daha fazla harca
    val cut =
        t.match(Regex("""(?:harcama|gider|masraf|bütçe)\p{L}*\s+(?:\p{L}+\s+){0,2}?$AMOUNT\s*(?:\p{L}+\s+)?(?:azalt|kıs|düşür|indir)""")) ?:
        t.match(Regex("""$AMOUNT\s*(?:\p{L}+\s+)?(?:daha\s+)?az\s+harca"""))
    val more = t.match(Regex("""$AMOUNT\s*(?:\p{L}+\s+)?(?:daha\s+)?fazla\s+harca"""))
    if (cut != null) ops.add(Op.SetNumber(NumericSetting.EXPENSE_DELTA, -amountValue(cut[1], cut[2])))
    else if (more != null) ops.add(Op.SetNumber(NumericSetting.EXPENSE_DELTA, amountValue(more[1], more[2])))

    // 3a'yı doldur / 3a'ya başla / 3a'yı durdur / bireysel emeklilik
    if (Regex("""(?<![\p{L}\d])3a(?![\d])|3\.\s*sütun|üçüncü\s+sütun|bireysel\s+emeklilik""").containsMatchIn(t)) {
        if (Regex("""(durdur|bırak|birak|kes|iptal|vazgeç|artık\s+ödeme)""").containsMatchIn(t)) ops.add(Op.SetFlag(FlagSetting.CONTRIBUTES_3A, false))
        else if (Regex("""(maks|doldur|başla|basla|aç|öde|yat[ıi]r|kullan|tam)""").containsMatchIn(t)) ops.add(Op.SetFlag(FlagSetting.CONTRIBUTES_3A, true))
    }

    // ev alımını 2 yıl ertele / 6 ay sonraya ertele
    val delay =
        t.match(Regex("""(\d+)\s*(yıl|yil|sene|ay)\p{L}*\s+(?:\p{L}+\s+){0,2}?(?:ertele|geciktir|ötele|otele|bekle|ileri\s+al)""")) ?:
        t.match(Regex("""(?:ertele|geciktir|ötele|otele)\p{L}*\D{0,30}?(\d+)\s*(yıl|yil|sene|ay)"""))
    if (delay != null && house != null) ops.add(Op.Shift(house.id, months(delay.count(1), years = delay[2] != "ay")))

    // Bern'de 1,2 milyona ev satın al / 900 bine daire almak
    if (Regex("""(satın\s+al|satin\s+al|alım|alim|almak|alsam|alırsam|alacağ|ev\s+al|daire\s+al)""").containsMatchIn(t) && Regex("""(ev(?!\p{L})|evi|daire|konut|mülk|villa)""").containsMatchIn(t)) {
        val price = largestAmountAbove(t, 50_000.0)
        if (price != null) {
            val where = text.match(Regex("""([A-ZÄÖÜÇŞİ][\p{L}-]+)['’](?:de|da|te|ta)(?!\p{L})"""))
            ops.add(homeEvent(where?.get(1), eventMonth ?: house?.month ?: 24, price))
        }
    }

    // işimi kaybedersem / işsiz kalırsam / işten çıkarılırsam
    if (Regex("""(iş|is)\p{L}*\s+(?:\p{L}+\s+){0,3}?kayb|işsiz|issiz|işten\s+çıkar|isten\s+cikar|kovul""").containsMatchIn(t)) {
        val dur = t.match(Regex("""(\d+)\s*ay(?!da)"""))
        ops.add(event(EventType.JOBLOSS, "event.jobLoss", eventMonth ?: 12, 0.0, dur?.count(1) ?: 6))
    }

    // borsa çöküşü / piyasa krizi / resesyon
    if (Regex("""(borsa|piyasa)\p{L}*\s+(çök|cok|kriz|düş|dus)|çöküş|resesyon|kriz|crash""").containsMatchIn(t)) {
        ops.add(event(EventType.CRASH, "event.crash", eventMonth ?: 12, 0.0))
    }

    // bebeğimiz olacak / çocuk / doğum
    if (Regex("""(bebe|bebek|çocu|cocu|doğum|hamile)""").containsMatchIn(t)) {
        ops.add(event(EventType.CHILD, "event.baby", eventMonth ?: 18, 1500.0, 216))
    }

    // 10 bin zam
    val raise = t.match(Regex("""(?:zam|terfi|maaş\s+artışı)\D{0,20}$AMOUNT""")) ?: t.match(Regex("""$AMOUNT\s*(?:\p{L}+\s+)?zam"""))
    if (raise != null) ops.add(event(EventType.RAISE, "event.raise", eventMonth ?: 6, amountValue(raise[1], raise[2])))

    return ops
}
