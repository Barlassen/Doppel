package ch.doppel.pocket.finance

enum class RiskProfile { CONSERVATIVE, BALANCED, GROWTH }
enum class EventType { HOUSE, CHILD, JOBLOSS, CRASH, RAISE, EXPENSE, INCOME }
enum class EventSource { PROFILE, SNAP, COMMAND, SOLVER }
enum class Category { GROCERIES, DINING, TRANSPORT, SUBSCRIPTIONS, SHOPPING, HOUSING, INSURANCE, BILLS, TRAVEL, INVESTING }
enum class Horizon { FULL, GOAL }

data class Message(val key: String, val params: Map<String, Any> = emptyMap())

fun message(key: String, vararg params: Pair<String, Any>) = Message(key, mapOf(*params))

data class LifeEvent(
    val id: String,
    val type: EventType,
    val label: String,
    val month: Int,
    val amount: Double,
    val durationMonths: Int? = null,
    val source: EventSource? = null,
    val labelMsg: Message? = null,
)

data class Transaction(
    val date: String,
    val merchant: String,
    val category: Category,
    val amount: Double,
    val note: String? = null,
)

/** Target net worth includes pillar 2, pillar 3a and home equity, in today's CHF. */
data class Goal(val target: Double, val age: Int)
data class History(val soldInDrawdown: Boolean, val drawdownSellPct: Double)

data class Profile(
    val id: String,
    val name: String,
    val age: Int,
    val city: String,
    val canton: String,
    val tagline: Message,
    val grossIncomeYear: Double,
    val netIncomeMonth: Double,
    val expensesMonth: Double,
    val rentMonth: Double,
    val cash: Double,
    val portfolio: Double,
    val pillar2: Double,
    val pillar3a: Double,
    val contributes3a: Boolean,
    val investShare: Double,
    val marginalTaxRate: Double,
    val riskProfile: RiskProfile,
    val retirementAge: Int,
    val goal: Goal,
    val events: List<LifeEvent>,
    val transactions: List<Transaction>,
    val history: History,
)

data class BehaviorParams(
    val leakageRate: Double,
    val panicSellProb: Double,
    val panicSellShare: Double,
    val panicOutMonths: Int,
)

data class RecurringExpense(val id: String, val label: String, val monthly: Double, val source: EventSource? = null)
data class Income(val grossIncomeYear: Double, val netIncomeMonth: Double, val label: String = "")

data class Scenario(
    val events: List<LifeEvent>,
    val expenseDelta: Double = 0.0,
    val optimize: Boolean = false,
    val monthlyInvest: Double = 0.0,
    val riskProfile: RiskProfile? = null,
    val contributes3a: Boolean? = null,
    val retirementAge: Int? = null,
    val income: Income? = null,
    val recurring: List<RecurringExpense> = emptyList(),
    val extraTx: List<Transaction> = emptyList(),
)

const val HEADLINE_SEED = 42
const val HEADLINE_PATHS = 1_000

data class SimInput(
    val profile: Profile,
    val events: List<LifeEvent>,
    val behavior: BehaviorParams? = null,
    val paths: Int = HEADLINE_PATHS,
    val seed: Int = HEADLINE_SEED,
    val expenseDelta: Double = 0.0,
    val optimizeIdleCash: Boolean = false,
    val optimizeFromMonth: Int = 0,
    val monthlyInvest: Double = 0.0,
    val horizon: Horizon = Horizon.FULL,
)

data class YearBand(val year: Int, val age: Int, val p10: Double, val p50: Double, val p90: Double)

data class HouseStats(
    val eventId: String,
    val label: String,
    val labelMsg: Message?,
    val price: Double,
    val month: Int,
    val boughtProb: Double,
    val medianHardEquity: Double,
    val medianPillar2: Double,
    val grossAtPurchase: Double,
    val closingRate: Double,
    val medianEquityAtPurchase: Double,
    val medianLoan: Double,
)

data class RetirementStats(
    val age: Int,
    val lastsTo90Prob: Double,
    val depletionAgeP10: Int?,
    val replacementRatio: Double,
    val monthlyIncomeAtRetirement: Double,
    val ahvMonthly: Double,
    val bvgMonthly: Double,
    val monthlySpending: Double,
    val medianLiquidAtRetirement: Double,
    val bridgeYears: Int,
)

data class SimResult(
    val bands: List<YearBand>,
    val successProb: Double,
    val crunchProb: Double,
    val medianAtGoal: Double,
    val goalMonth: Int,
    val retirementAge: Int,
    val ms: Double,
    val paths: Int,
    val house: HouseStats?,
    val retirement: RetirementStats?,
)
