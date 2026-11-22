/**
 * Types of the UBS LauzHack 2026 synthetic starter data as Doppel ships it (`scripts/build-ubs-data.ts` →
 * `src/lib/ubs/generated/*`). All people and figures are fictional.
 */

export const ALEXIA_ID = "P00001";

/** Search row for the picker and the game: identity plus the UBS-only balance sheet (no Doppel estimates). */
export interface UbsProfileSummary {
  id: string;
  name: string;
  age: number;
  city: string;
  canton: string;
  employment: string;
  household: string;
  /** UBS assets (cash + investment portfolio) − UBS liabilities. Excludes Doppel's pillar 2 estimate. */
  netWorthChf: number;
  /** Sum of the opening principals of the profile's UBS liabilities. */
  debtChf: number;
  goalCount: number;
}

export interface UbsScenario {
  id: string;
  category: string;
  scenario: string;
  baseline: string;
  intervention: string;
  metrics: string;
}

export interface UbsAssumption {
  id: string;
  scenarioId: string;
  profileId: string;
  parameter: string;
  value: number;
  unit: string;
  frequency: string;
  sourceType: string;
  notes: string;
}

export interface AlexiaPath {
  name: string;
  phases: { startMonth: number; endMonth: number; monthlyIncomeChf: number; monthlyExpensesChf: number }[];
  oneOffCosts: { month: number; amountChf: number }[];
}

/** One UBS goal as in `synthetic-goals.csv`. */
export interface UbsGoalRow {
  id: string;
  name: string;
  targetChf: number;
  /** ISO date. */
  targetDate: string;
  priority: "high" | "medium" | "low";
}

/** One UBS liability as in `synthetic-liabilities.csv`. */
export interface UbsLiabilityRow {
  id: string;
  type: string;
  principalChf: number;
  annualRate: number;
  /** 0 in every row of the starter data: "opening debt snapshot only; not amortized". */
  monthlyPaymentChf: number;
}

/** Everything the starter data says about one person, before Doppel fills any gap. */
export interface UbsRawProfile {
  id: string;
  name: string;
  age: number;
  city: string;
  canton: string;
  employment: string;
  household: string;
  asOf: string;
  cashChf: number;
  investmentsChf: number;
  /** Assets other than cash and the investment portfolio (none in the starter data, kept for completeness). */
  otherAssetsChf: number;
  monthlyNetIncomeChf: number;
  monthlyRentChf: number;
  liabilities: UbsLiabilityRow[];
  goals: UbsGoalRow[];
}

/** Compact detail row in a generated chunk (see `build-ubs-data.ts`). */
export type DetailRow = [
  name: string,
  age: number,
  city: string,
  canton: string,
  employment: string,
  household: string,
  cash: number,
  investments: number,
  otherAssets: number,
  netIncome: number,
  rent: number,
  /** [id suffix, type, principal, annual rate, monthly payment] */
  liabilities: [string, string, number, number, number][],
  /** [id suffix, goal-name index, target, target date, priority index] */
  goals: [string, number, number, string, number][],
];

/** Compact summary row: [number, name, age, city idx, canton idx, employment idx, household idx, net worth, debt, goals]. */
export type SummaryRow = [number, string, number, number, number, number, number, number, number, number];
