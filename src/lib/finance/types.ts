export type RiskProfile = "conservative" | "balanced" | "growth";

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
  label: string;
  /** Months from today when the event starts. */
  month: number;
  /** CHF. House: purchase price. Expense/income: one-off amount. Raise: +gross/yr. Child: monthly cost. */
  amount: number;
  /** For recurring effects (job loss, child cost). */
  durationMonths?: number;
  /** Where the event came from — shown in the UI. */
  source?: "profile" | "snap" | "command" | "solver";
}

export interface Transaction {
  date: string; // ISO yyyy-mm-dd
  merchant: string;
  category:
    | "groceries"
    | "dining"
    | "transport"
    | "subscriptions"
    | "shopping"
    | "housing"
    | "insurance"
    | "bills"
    | "travel"
    | "investing";
  amount: number; // CHF, positive = spend
  note?: string;
}

export interface Goal {
  label: string;
  /** Liquid wealth target (cash + portfolio + 3a), CHF, in today's money. */
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
  tagline: string;
  grossIncomeYear: number;
  netIncomeMonth: number;
  /** Total monthly spending including rent. */
  expensesMonth: number;
  rentMonth: number;
  cash: number;
  portfolio: number;
  pillar2: number;
  pillar3a: number;
  contributes3a: boolean;
  /** Share of the monthly surplus the person actually invests (rest sits as cash). */
  investShare: number;
  marginalTaxRate: number;
  riskProfile: RiskProfile;
  retirementAge: number;
  goal: Goal;
  events: LifeEvent[];
  transactions: Transaction[];
  /** Observed history used by the behavioural engine. */
  history: {
    soldInDrawdown: boolean;
    drawdownSellPct: number; // share of equities sold in last big drawdown
  };
}

export interface BehaviorParams {
  /** Share of monthly surplus that leaks to impulse spending. */
  leakageRate: number;
  /** Probability of panic-selling equities in a >15% drawdown. */
  panicSellProb: number;
  /** Months spent in cash after a panic sale. */
  panicOutMonths: number;
}

export interface SimInput {
  profile: Profile;
  events: LifeEvent[];
  behavior?: BehaviorParams;
  paths?: number;
  seed?: number;
  /** Extra monthly expense change (negative = cut). Used by the solver. */
  expenseDelta?: number;
  /** Invest idle cash above a 3-month buffer and max out pillar 3a. */
  optimizeIdleCash?: boolean;
}

export interface YearBand {
  year: number;
  age: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface SimResult {
  bands: YearBand[];
  successProb: number;
  crunchProb: number;
  medianAtGoal: number;
  goalMonth: number;
  ms: number;
  paths: number;
}
