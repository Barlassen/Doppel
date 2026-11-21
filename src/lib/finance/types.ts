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
}

export const TRANSACTION_CATEGORIES = [
  "groceries", "dining", "transport", "subscriptions", "shopping",
  "housing", "insurance", "bills", "travel", "investing",
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

export interface Goal {
  label: Msg;
  /** Net-worth target (see GOAL_DEFINITION), CHF in today's money. */
  target: number;
  /** Age at which the goal should be reached. */
  age: number;
}

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
  price: number;
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
}

export interface RetirementStats {
  age: number;
  /** Share of futures in which liquid savings (cash, portfolio, 3a) never run out before 90. */
  lastsTo90Prob: number;
  /** In the worst 10% of futures, the age at which savings run out (null = lasts beyond 90 even then). */
  depletionAgeP10: number | null;
  /** Gross pension (AHV + BVG, from 65) / last gross salary. */
  replacementRatio: number;
  /** Gross pension income per month from 65, today's CHF (median). */
  monthlyIncomeAtRetirement: number;
  ahvMonthly: number;
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
}
