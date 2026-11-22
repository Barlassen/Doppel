import type { Msg, Text } from "@/lib/i18n/types";

export type RiskProfile = "conservative" | "balanced" | "growth";

export const RISK_PROFILES: RiskProfile[] = ["conservative", "balanced", "growth"];

export type EventType =
  | "house"
  | "child"
  | "jobloss"
  | "crash"
  | "raise"
  | "expense"
  | "income";

export interface LifeEvent {
  id: string;
  type: EventType;
  /** Plain label: data for the LLM prompt and scripts (English for built-in events, as typed for LLM ones). */
  label: string;
  /** Translatable label for the UI, when the event was created by Doppel itself (profile, parser, snap). */
  labelMsg?: Msg;
  /** Months from today when the event starts. */
  month: number;
  /** CHF. House: purchase price. Expense/income: one-off amount. Raise: +gross/yr. Child: monthly cost. */
  amount: number;
  /** For recurring effects (job loss, child cost). */
  durationMonths?: number;
  /** Where the event came from — shown in the UI. */
  source?: "profile" | "snap" | "command" | "solver";
  /**
   * True = `amount` is nominal CHF at the event's date, taken as given (e.g. the UBS starter kit's one-off costs).
   * Default: `amount` is in today's CHF and is indexed to its date (prices for one-offs, home prices for a home).
   */
  nominal?: boolean;
}

export const TRANSACTION_CATEGORIES = [
  "groceries", "dining", "transport", "subscriptions", "shopping",
  "housing", "insurance", "bills", "travel", "investing",
  // Imported rows that no rule or model could place ("review needed"). Counts as spending, not discretionary.
  "other",
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export interface ReceiptItem {
  name: string;
  qty?: number;
  unitPrice?: number;
  /** Signed line total in the receipt currency. Discounts are negative. */
  amount: number;
  category?: TransactionCategory;
}

export interface Transaction {
  date: string; // ISO yyyy-mm-dd
  merchant: string;
  category: TransactionCategory;
  amount: number; // CHF, positive = spend
  note?: string;
  items?: ReceiptItem[];
}

/**
 * One investment order from a broker or pillar 3a statement. Trades (not hand-set flags) drive the investing side
 * of the behavioural twin: see `deriveInvestBehavior()` in `investBehavior.ts`.
 */
export interface InvestmentTrade {
  date: string; // ISO yyyy-mm-dd
  account: "broker" | "3a";
  /** Display name of the security, e.g. "Vanguard FTSE All-World (VWRL)". Data, never translated. */
  instrument: string;
  /** "stock" = a single company; "fund" (default) = a diversified fund or ETF. */
  kind?: "fund" | "stock";
  side: "buy" | "sell";
  amount: number; // CHF, positive for buys and sells
  units?: number;
  /** CHF per unit at execution. */
  price?: number;
}

/**
 * The goal is measured on **net worth incl. pension & home equity**, in today's CHF:
 * cash + portfolio + pillar 3a + pillar 2 (vested benefits) + (home value − mortgage).
 * After retirement, pillar 2 is shown as the remaining value of the annuity it was converted into.
 */
export const GOAL_DEFINITION = "net worth incl. pillar 2, pillar 3a & home equity, today's CHF";

/**
 * What a goal measures, at its date, in today's CHF:
 *  - `netWorth` (default): GOAL_DEFINITION, net of liabilities
 *  - `cash`: cash on the bank account only (an emergency fund must be liquid, not invested)
 *  - `liquid`: cash + investment portfolio (pillar 3a and pillar 2 are locked)
 *  - `deposit`: cash + portfolio + pillar 3a (3a may be withdrawn early for an owner-occupied home)
 */
export type GoalMetric = "netWorth" | "cash" | "liquid" | "deposit";

export interface Goal {
  label: Msg;
  /** Target in today's CHF, measured by `metric` (default: net worth, see GOAL_DEFINITION). */
  target: number;
  /** Age at which the goal should be reached. */
  age: number;
  /** Default "netWorth". */
  metric?: GoalMetric;
}

/** One of several goals (UBS profiles have 1–N). The engine scores each on the same simulated futures. */
export interface ProfileGoal extends Goal {
  id: string;
  priority: "high" | "medium" | "low";
  /** ISO date of the target, for display (the engine uses `age`). */
  targetDate?: string;
  /** The goal shown as the headline (highest priority, then earliest date). */
  primary?: boolean;
}

/**
 * A debt on the balance sheet. Personal loans amortise with a fixed annuity; a `mortgage` liability with no
 * payment is interest-only (Swiss first mortgages usually are). A home bought through a `house` event keeps its own
 * mortgage logic in the simulator.
 */
export interface Liability {
  id: string;
  kind: "personal_loan" | "mortgage";
  label: Text;
  /** Outstanding balance at month 0, CHF. */
  principal: number;
  /** Nominal yearly rate, e.g. 0.0593. */
  annualRate: number;
  /** Contractual monthly payment (interest + principal), CHF. */
  monthlyPayment: number;
  /** Remaining term in months the payment was derived from (when the data had no payment). */
  termMonths?: number;
  /** True when `monthlyPayment` was derived from a default term because the data had none. */
  paymentDerived?: boolean;
}

/** Where a profile field's value comes from (shown in the UI next to the value). */
export type Provenance = "ubs_synthetic" | "doppel_default" | "derived";

export interface Profile {
  id: string;
  name: string;
  age: number;
  city: string;
  canton: string;
  tagline: Msg;
  grossIncomeYear: number;
  /** Monthly take-home pay after social deductions AND income tax (12 equal months). */
  netIncomeMonth: number;
  /** Total monthly spending including rent. */
  expensesMonth: number;
  rentMonth: number;
  cash: number;
  portfolio: number;
  pillar2: number;
  pillar3a: number;
  contributes3a: boolean;
  /** Share of the monthly surplus the person actually invests (rest sits as cash). Derived from `trades`. */
  investShare: number;
  marginalTaxRate: number;
  /**
   * Monthly mandatory health-insurance premiums contained in `expensesMonth` (KVG, canton-dependent). They grow
   * faster than prices (`HEALTH_EXCESS_GROWTH`). Absent = a one-person household in `canton` (see canton.ts).
   */
  healthPremiumMonth?: number;
  riskProfile: RiskProfile;
  retirementAge: number;
  goal: Goal;
  events: LifeEvent[];
  transactions: Transaction[];
  /** Broker and pillar 3a orders over the same window as `transactions`. */
  trades: InvestmentTrade[];
  /** Observed history used by the behavioural engine (derived from `trades` for the built-in accounts). */
  history: {
    soldInDrawdown: boolean;
    drawdownSellPct: number; // share of equities sold in last big drawdown
  };
  /** Loans and other debts (none for the built-in accounts). Net worth = assets − liabilities. */
  liabilities?: Liability[];
  /** All goals of the profile incl. the headline one (`goal` is the primary). Absent = just `goal`. */
  goals?: ProfileGoal[];
  /** False = no pension fund (self-employed, not insured): no BVG credits. Default true. */
  bvgInsured?: boolean;
  /** ISO date of the starting balance sheet = month 0 (default: today). */
  asOf?: string;
  /** Imported from an external dataset (read-only base data). */
  origin?: { dataset: "ubs-lauzhack-2026"; id: string; employment: string; household: string };
  /** Source of each profile field, for profiles not entered by hand. */
  provenance?: Partial<Record<string, Provenance>>;
}

export interface BehaviorParams {
  /** Share of monthly surplus that leaks to impulse spending. */
  leakageRate: number;
  /** Probability of panic-selling in a >15% drawdown. */
  panicSellProb: number;
  /** Share of the portfolio sold in a panic. */
  panicSellShare: number;
  /** Minimum months in cash after a panic sale; re-entry also waits until the market regained its old peak. */
  panicOutMonths: number;
}

/** A recurring cost added to the twin (e.g. from a snapped QR-bill premium). */
export interface RecurringExpense {
  id: string;
  label: Text;
  monthly: number;
  source?: LifeEvent["source"];
}

/**
 * Everything the user can change on top of the base profile. "Plan A" and "Plan B" are two Scenarios
 * simulated with the same seed, so the difference between them is the decision, not luck.
 */
export interface Scenario {
  events: LifeEvent[];
  /** CHF/month change of spending (negative = cut). */
  expenseDelta: number;
  /** Invest idle cash above a 3-month buffer, invest all surplus and max out pillar 3a. */
  optimize: boolean;
  /** Standing order: extra CHF/month invested on payday (before impulse spending can leak it). */
  monthlyInvest: number;
  riskProfile?: RiskProfile;
  contributes3a?: boolean;
  retirementAge?: number;
  /** Income read from a payslip (overrides the profile). */
  income?: { grossIncomeYear: number; netIncomeMonth: number; label: Text } | null;
  recurring: RecurringExpense[];
  /** Snapped receipts — feed the "this month" figure of the behavioural twin. */
  extraTx: Transaction[];
  /** Extra CHF/month paid on top of the loans' contractual payments (highest rate first). */
  debtExtra?: number;
  /** Income and spending set per period (e.g. the UBS starter kit's life paths). */
  phases?: CashflowPhase[];
  /** Name of the applied life path, for its pill. */
  path?: { id: string; label: Text };
}

/**
 * A period with given take-home income and total spending (both CHF/month, nominal, not indexed, as in the UBS
 * `scenario_config.json`). Months `startMonth` ≤ m < `endMonth`. After the last phase the last one continues,
 * indexed with wage growth and inflation from its end.
 */
export interface CashflowPhase {
  startMonth: number;
  endMonth: number;
  netIncomeMonth: number;
  expensesMonth: number;
  /** Gross salary (CHF/yr) behind `netIncomeMonth`, for pillar 2 credits and the bank test. */
  grossIncomeYear: number;
  /** False = not insured in a Swiss pension fund during the phase (e.g. working abroad). Default true. */
  bvgInsured?: boolean;
}

export interface SimInput {
  profile: Profile;
  events: LifeEvent[];
  behavior?: BehaviorParams;
  paths?: number;
  seed?: number;
  /** Extra monthly expense change (negative = cut). */
  expenseDelta?: number;
  /** Invest idle cash above a 3-month buffer, invest all surplus and max out pillar 3a. */
  optimizeIdleCash?: boolean;
  /** Month from which the optimize lever starts (cost of waiting). Default 0 = now. */
  optimizeFromMonth?: number;
  /** Standing order: CHF/month invested on payday before leakage. */
  monthlyInvest?: number;
  /**
   * "full" (default) simulates to age 90 (retirement included).
   * "goal" stops right after the goal age (and the planned home) — identical goal odds, much faster.
   */
  horizon?: "full" | "goal";
  /** Extra CHF/month on the loans (highest rate first). */
  extraDebtPayment?: number;
  /** Income/spending per period, overriding the profile in those months. */
  phases?: CashflowPhase[];
  /**
   * Accounting mode for validation: every return, rate, inflation and wage growth is zero and nothing is random,
   * so cash must follow the plain ledger (opening cash + income − spending − one-offs − debt service).
   */
  accounting?: boolean;
  /** Record path 0's month-end cash and debt (nominal CHF) in `SimResult.trace`. */
  trace?: boolean;
}

export interface GoalStats {
  id: string;
  /** Share of futures in which the goal is reached at its date (same rule as the headline). */
  prob: number;
  /** Median value of the goal's metric at its date, today's CHF. */
  median: number;
  month: number;
}

export interface DebtStats {
  /** Debt at month 0, CHF. */
  start: number;
  /** Contractual debt service in month 0, CHF/month. */
  monthlyService: number;
  /** Month in which the last loan is repaid (deterministic: payments are fixed), null = beyond the horizon. */
  debtFreeMonth: number | null;
  /** Interest paid until debt-free (nominal CHF). */
  interestPaid: number;
}

export interface YearBand {
  year: number;
  age: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface HouseStats {
  eventId: string;
  label: string;
  labelMsg?: Msg;
  /** Price at the purchase date (nominal CHF): the amount the bank test and the mortgage use. */
  price: number;
  /** The price as entered, in today's CHF. */
  priceToday?: number;
  month: number;
  /** Share of futures in which the bank test passed at the purchase date and the home was bought. */
  boughtProb: number;
  /** Median liquid "hard" equity above the 3-month cash buffer at purchase (nominal CHF, before closing costs). */
  medianHardEquity: number;
  medianPillar2: number;
  /** Gross income (CHF/yr, nominal) at the purchase date. */
  grossAtPurchase: number;
  closingRate: number;
  /** Among futures that bought: equity actually put in and the resulting mortgage. */
  medianEquityAtPurchase: number;
  medianLoan: number;
  /** Median yearly debt service on other loans at the purchase date (only when the profile has liabilities). */
  medianOtherDebtYear?: number;
}

export interface RetirementStats {
  age: number;
  /** Share of futures in which liquid savings (cash, portfolio, 3a) never run out before 90. */
  lastsTo90Prob: number;
  /** In the worst 10% of futures, the age at which savings run out (null = lasts beyond 90 even then). */
  depletionAgeP10: number | null;
  /** Gross pension (AHV + BVG) from the AHV reference age / last gross salary, both in today's CHF. */
  replacementRatio: number;
  /**
   * Gross pension income per month at the retirement date, today's CHF (median): the BVG annuity, plus AHV only
   * when the retirement age is the AHV reference age or later. Before that the gap is bridged from savings.
   */
  monthlyIncomeAtRetirement: number;
  /** Gross pension income per month from the AHV reference age (BVG + AHV), today's CHF. */
  monthlyIncomeFromAhvAge?: number;
  /** The BVG annuity at the AHV reference age in today's CHF (it is fixed in nominal CHF, so it shrinks with prices). */
  bvgMonthlyAtAhvAge?: number;
  /** The BVG annuity at the end of the simulation (age 90) in today's CHF. */
  bvgMonthlyAtEnd?: number;
  ahvMonthly: number;
  /** The BVG annuity at the retirement date, today's CHF (median). */
  bvgMonthly: number;
  /** Monthly spending in retirement, today's CHF (median, incl. housing). */
  monthlySpending: number;
  medianLiquidAtRetirement: number;
  /** Years between retirement and the first AHV payment (bridged from savings). */
  bridgeYears: number;
}

export interface SimResult {
  bands: YearBand[];
  successProb: number;
  /** The monthly spending change the engine applied (`expenseDelta`, limited so that spending never falls below the rent). */
  expenseDeltaApplied?: number;
  /** Share of futures that run out of cash before the goal age. */
  crunchProb: number;
  medianAtGoal: number;
  goalMonth: number;
  retirementAge: number;
  ms: number;
  paths: number;
  house?: HouseStats;
  /** Only present for full-horizon runs. */
  retirement?: RetirementStats;
  /** One entry per `profile.goals` goal inside the horizon (only when the profile lists goals). */
  goals?: GoalStats[];
  /** Only when the profile has liabilities. */
  debt?: DebtStats;
  trace?: { cash: number[]; debt: number[]; p3a?: number[] };
}
