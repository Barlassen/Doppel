package ch.doppel.pocket.twin

import ch.doppel.pocket.LocalDate
import ch.doppel.pocket.finance.*
import ch.doppel.pocket.snap.QrExpense
import ch.doppel.pocket.snap.parseQrBill
import ch.doppel.pocket.snap.reviewQrExpense
import ch.doppel.pocket.snap.withQrExpense
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LocalInputTest {
    private val profile = profiles.first()
    private val events = profile.events
    private val now = LocalDate(2026, 0)

    @Test
    fun parsesLocalizedExamples() {
        val whatIfs = mapOf(
            Language.EN to listOf("What if I lose my job for 6 months in 2028?", "Delay the flat by 2 years",
                "Market crash next year", "We have a baby in 2028", "Retire at 60", "Invest 500 a month"),
            Language.DE to listOf("Was, wenn ich 2028 für 6 Monate meine Stelle verliere?", "Den Eigenheimkauf um 2 Jahre nach hinten schieben",
                "Nächstes Jahr brechen die Märkte ein", "Wir erwarten 2028 Nachwuchs", "Mit 60 pensioniert werden", "Investiere Fr. 500 pro Monat"),
            Language.FR to listOf("Perdre mon emploi pendant 6 mois en 2028", "Reporter l’achat de 2 ans",
                "Krach boursier l’an prochain", "Naissance d’un enfant en 2028", "Prendre ma retraite à 60 ans", "Placer 500.– par mois"),
            Language.TR to listOf("2028'de 6 ay işsiz kalırsam ne olur?", "Ev alımını 2 yıl ertele",
                "Gelecek yıl borsa çöküşü", "2028'de bebeğimiz olursa", "60 yaşında emekli ol", "Ayda 500 yatırım yap"),
        )
        for ((language, examples) in whatIfs) {
            val changes = examples.map { text -> localParseCommand(text, events, now, language).single() }
            val jobLoss = changes[0] as Op.Add
            assertEquals(EventType.JOBLOSS, jobLoss.type)
            assertEquals(30, jobLoss.month)
            assertEquals(6, jobLoss.duration)
            assertEquals(Op.Shift("ev-house", 24), changes[1])
            val crash = changes[2] as Op.Add
            assertEquals(EventType.CRASH, crash.type)
            assertEquals(12, crash.month)
            val baby = changes[3] as Op.Add
            assertEquals(EventType.CHILD, baby.type)
            assertEquals(30, baby.month)
            assertEquals(Op.SetNumber(NumericSetting.RETIREMENT_AGE, 60.0), changes[4])
            assertEquals(Op.SetNumber(NumericSetting.MONTHLY_INVEST, 500.0), changes[5])
        }
    }

    @Test
    fun validatesAmountsAndAppliesRecognizedCommands() {
        val exampleAmounts = mapOf(
            Language.EN to "Invest CHF 1'200 per month",
            Language.DE to "Jeden Monat 1.200 in Fonds stecken",
            Language.FR to "J’investis 1 200 par mois",
            Language.TR to "Ayda 1.200 yatırım yap",
        )
        for ((language, command) in exampleAmounts) {
            val result = localParseCommand(command, events, now, language)
            assertEquals(listOf(Op.SetNumber(NumericSetting.MONTHLY_INVEST, 1_200.0)), result, command)
            assertEquals(1_200.0, applyScenarioOps(baseScenario(profile), result).monthlyInvest)
        }
        val purchase = localParseCommand("Für 2028 eine Wohnung in St. Gallen für CHF 1,2 Mio. kaufen", events, now, Language.DE)
        val house = applyScenarioOps(baseScenario(profile), purchase).events.single()
        assertEquals(1_200_000.0, house.amount)
        assertEquals("Home in St. Gallen", house.label)
        assertEquals(30, house.month)
        assertEquals(listOf(Op.Shift("ev-house", 6)),
            localParseCommand("Ev alımını 6 ay ertele", events, now, Language.TR))
        assertEquals(listOf(Op.SetNumber(NumericSetting.RETIREMENT_AGE, 60.0)),
            localParseCommand("Retire at 60", events, now, Language.FR))
        assertTrue(localParseCommand("Buy a home for 50m", events, now).isEmpty())
        assertTrue(localParseCommand("Delay the home by 9999999999999999 years", events, now).isEmpty())
        assertTrue(localParseCommand("Retire at 40", events, now).isEmpty())
    }

    @Test
    fun readsSwissQrBillFieldsAndRejectsInvalidHeaders() {
        val lines = MutableList(32) { "" }
        mapOf(0 to "SPC", 1 to "0200", 2 to "1", 3 to "CH4431999123000889012", 4 to "S",
            5 to "Limmat Krankenkasse AG", 8 to "8001", 9 to "Zürich", 10 to "CH", 18 to "412.00",
            19 to "CHF", 21 to "Lukas", 27 to "NON", 29 to "Prämie Dezember 2026", 30 to "EPD")
            .forEach { (index, contents) -> lines[index] = contents }
        val bill = assertNotNull(parseQrBill(lines.joinToString("\r\n")))
        assertEquals("CH4431999123000889012", bill.iban)
        assertEquals("Zürich", bill.creditor.town)
        assertEquals("8001", bill.creditor.postcode)
        assertEquals("Lukas", bill.debtorName)
        assertEquals(412.0, bill.amount)
        assertEquals(Category.INSURANCE, bill.category)
        val scenario = baseScenario(profile)
        assertEquals(QrExpense.AlreadyBudgeted, reviewQrExpense(bill, profile, scenario))
        val recurringBill = bill.copy(amount = 1_500.0, message = "Quartalsprämie")
        val recurring = reviewQrExpense(recurringBill, profile, scenario)
        assertEquals(QrExpense.Recurring(500.0), recurring)
        val budget = scenario.withQrExpense(recurringBill, recurring)
        assertEquals(500.0, budget.recurring.single().monthly)
        assertEquals(QrExpense.AlreadyBudgeted, reviewQrExpense(recurringBill, profile, budget))
        val invoice = bill.copy(creditor = bill.creditor.copy(name = "Velowerkstatt"), message = "Reparatur")
        val oneOff = reviewQrExpense(invoice, profile, scenario)
        assertEquals(QrExpense.OneOff(412.0), oneOff)
        val entry = scenario.withQrExpense(invoice, oneOff).events.last()
        assertEquals(0, entry.month)
        assertEquals(EventType.EXPENSE, entry.type)
        assertEquals(QrExpense.InvalidAmount, reviewQrExpense(invoice.copy(currency = "EUR"), profile, scenario))
        lines[18] = "NaN"
        assertNull(assertNotNull(parseQrBill(lines.joinToString("\n"))).amount)
        lines[30] = ""
        assertNull(parseQrBill(lines.joinToString("\n")))
    }
}
