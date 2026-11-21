package ch.doppel.pocket.finance

import ch.doppel.pocket.finance.Category.*

/** Deterministic transaction history for the fictional Doppel profiles (Aug–Oct 2026). */
private fun buildTransactions(scale: Double, heavyPayday: Boolean): List<Transaction> = buildList {
    var seed = 11L
    fun random(): Double {
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647.0
    }
    fun rounded(x: Double) = jsRound(x * 20) / 20

    for (month in listOf("2026-08", "2026-09", "2026-10")) {
        fun addTx(day: Int, merchant: String, category: Category, amount: Double) {
            add(Transaction("$month-${day.toString().padStart(2, '0')}", merchant, category, amount))
        }

        addTx(1, "Rent", HOUSING, rounded(2150 * scale))
        addTx(3, "Health insurance", INSURANCE, rounded(412 * scale))
        addTx(5, "Mobile & internet", BILLS, 79.9)
        addTx(6, "Streaming video", SUBSCRIPTIONS, 20.9)
        addTx(6, "Music streaming", SUBSCRIPTIONS, 15.95)
        addTx(9, "Gym membership", SUBSCRIPTIONS, 89.0)
        addTx(12, "Cloud storage", SUBSCRIPTIONS, 9.9)
        addTx(2, "Half-fare + GA", TRANSPORT, rounded(340 * scale))

        for (day in 1..30) {
            if (day % 3 == 0) addTx(day, "Supermarket", GROCERIES, rounded((38 + random() * 55) * scale))
            val payday = day >= 25 || day <= 2
            val p = if (payday && heavyPayday) 0.6 else 0.3
            if (random() < p) {
                val amount = if (payday) 58 + random() * 90 else 19 + random() * 12
                addTx(day, if (payday) "Restaurant" else "Lunch", DINING, rounded(amount * scale))
            }
            if (payday && heavyPayday && random() < 0.2) {
                addTx(day, "Online shop", SHOPPING, rounded((60 + random() * 180) * scale))
            }
            if (!payday && random() < 0.06) {
                addTx(day, "Online shop", SHOPPING, rounded((30 + random() * 70) * scale))
            }
        }
    }
}

val profiles: List<Profile> = listOf(
    Profile(
        id = "lukas",
        name = "Lukas",
        age = 31,
        city = "Zürich",
        canton = "ZH",
        tagline = message("profile.lukas.tagline"),
        grossIncomeYear = 142_000.0,
        netIncomeMonth = 8_650.0,
        expensesMonth = 5_600.0,
        rentMonth = 2_150.0,
        cash = 64_000.0,
        portfolio = 38_000.0,
        pillar2 = 72_000.0,
        pillar3a = 21_000.0,
        contributes3a = false,
        investShare = 0.5,
        marginalTaxRate = 0.27,
        riskProfile = RiskProfile.BALANCED,
        retirementAge = 65,
        goal = Goal(1_400_000.0, 50),
        events = listOf(
            LifeEvent("ev-house", EventType.HOUSE, "Flat in Winterthur", 24, 780_000.0,
                source = EventSource.PROFILE, labelMsg = message("event.flatIn", "place" to "Winterthur")),
        ),
        transactions = buildTransactions(1.0, true),
        history = History(true, 0.6),
    ),
    Profile(
        id = "elena",
        name = "Elena",
        age = 44,
        city = "Genève",
        canton = "GE",
        tagline = message("profile.elena.tagline"),
        grossIncomeYear = 186_000.0,
        netIncomeMonth = 11_800.0,
        expensesMonth = 9_400.0,
        rentMonth = 3_300.0,
        cash = 48_000.0,
        portfolio = 210_000.0,
        pillar2 = 310_000.0,
        pillar3a = 85_000.0,
        contributes3a = true,
        investShare = 0.6,
        marginalTaxRate = 0.33,
        riskProfile = RiskProfile.GROWTH,
        retirementAge = 58,
        goal = Goal(1_700_000.0, 58),
        events = listOf(
            LifeEvent("ev-uni", EventType.EXPENSE, "University for Léa", 66, 60_000.0,
                source = EventSource.PROFILE, labelMsg = message("event.universityFor", "name" to "Léa")),
        ),
        transactions = buildTransactions(1.45, false),
        history = History(false, 0.0),
    ),
)
