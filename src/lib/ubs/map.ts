/**
 * UBS synthetic profile → Doppel `Profile`. Pure and deterministic.
 *
 * Every field is labelled (`Profile.provenance`):
 *  - `ubs_synthetic`  taken as given from the starter data
 *  - `derived`        computed from UBS fields with the engine's own Swiss rules (gross pay, pillar 2, loan payments)
 *  - `doppel_default` a documented Doppel assumption for something the data does not contain (tax rate, spending
 *                     split, 3a, risk profile, retirement age)
 * The constants below are the whole list of assumptions; `provenanceRows()` turns them into what the UI shows.
 */
import { annuityPayment, DEFAULT_LOAN_TERM_MONTHS } from "@/lib/finance/debt";
import { ASSUMPTIONS } from "@/lib/finance/monteCarlo";
import {
  AHV_FULL_INCOME,
  AHV_MIN_INCOME,
  RETIREMENT_TAX_FACTOR,
  SOCIAL_DEDUCTIONS,
  ahvMonthly,
  bvgAgeCredit,
  bvgConversionRate,
  coordinatedSalary,
  effectiveTaxRate,
} from "@/lib/finance/pension";
import type { GoalMetric, Liability, Profile, ProfileGoal, Provenance, RiskProfile } from "@/lib/finance/types";
import type { MessageKey, Msg } from "@/lib/i18n/types";
import type { UbsRawProfile } from "./types";

// ---------------- documented defaults (Doppel assumptions, not UBS data) ----------------

/**
 * Rough Swiss marginal income-tax rate (federal + cantonal + communal, single tariff) by yearly take-home pay.
 * Household splitting and cantonal differences are not modelled.
 */
export const MARGINAL_TAX_BRACKETS: readonly [upToNetYear: number, rate: number][] = [
  [20_000, 0.08],
  [40_000, 0.15],
  [60_000, 0.22],
  [80_000, 0.27],
  [110_000, 0.31],
  [150_000, 0.35],
  [Infinity, 0.38],
];
/** Share of take-home pay left after rent and loan payments that is NOT spent (saved). */
export const SAVED_SHARE = 0.25;
/** Minimum non-housing spending per month by household type (food, health insurance, transport, phone…). */
export const MIN_LIVING: Readonly<Record<string, number>> = { single: 1200, shared_housing: 1100, couple: 2000, family: 2800 };
export const DEFAULT_RETIREMENT_AGE = 65;
export const DEFAULT_RISK: RiskProfile = "balanced";
export const RETIRED_RISK: RiskProfile = "conservative";
/** Cap on the derived investing share of the surplus. */
export const MAX_INVEST_SHARE = 0.9;

/** What a UBS goal measures (see `GoalMetric`). */
export const GOAL_METRIC: Readonly<Record<string, GoalMetric>> = {
  "Emergency savings": "cash",
  "Housing deposit": "deposit",
  "Education flexibility": "liquid",
  "Career transition": "liquid",
  "Long-term financial resilience": "netWorth",
  "Retirement reserve": "netWorth",
};
const GOAL_KEY: Readonly<Record<string, MessageKey>> = {
  "Emergency savings": "ubs.goalName.emergency",
  "Housing deposit": "ubs.goalName.housing",
  "Education flexibility": "ubs.goalName.education",
  "Career transition": "ubs.goalName.career",
  "Long-term financial resilience": "ubs.goalName.resilience",
  "Retirement reserve": "ubs.goalName.retirement",
};
const EMPLOYMENT_KEY: Readonly<Record<string, MessageKey>> = {
  employed: "ubs.employment.employed",
  part_time: "ubs.employment.part_time",
  retired: "ubs.employment.retired",
  self_employed: "ubs.employment.self_employed",
  student: "ubs.employment.student",
  unemployed: "ubs.employment.unemployed",
};
const HOUSEHOLD_KEY: Readonly<Record<string, MessageKey>> = {
  single: "ubs.household.single",
  couple: "ubs.household.couple",
  family: "ubs.household.family",
  shared_housing: "ubs.household.shared_housing",
};
export const employmentMsg = (e: string): Msg | string => (EMPLOYMENT_KEY[e] ? { key: EMPLOYMENT_KEY[e] } : e);
export const householdMsg = (h: string): Msg | string => (HOUSEHOLD_KEY[h] ? { key: HOUSEHOLD_KEY[h] } : h);
export const goalNameMsg = (name: string): Msg | string => (GOAL_KEY[name] ? { key: GOAL_KEY[name] } : name);

// ---------------- derivations (engine rules) ----------------

export function marginalTaxFor(netMonth: number): number {
  const year = netMonth * 12;
  return MARGINAL_TAX_BRACKETS.find(([upTo]) => year < upTo)![1];
}

/**
 * Gross salary behind a take-home pay: the inverse of `takeHomeMonth()` (13% social deductions, effective tax
 * ≈ ½ × marginal rate), rounded to CHF 100 like a payslip snap.
 */
export function grossFromNet(netMonth: number, marginalTaxRate: number): number {
  const preTax = (netMonth * 12) / (1 - effectiveTaxRate(marginalTaxRate));
  return Math.round(preTax / (1 - SOCIAL_DEDUCTIONS) / 100) * 100;
}

/**
 * Pillar 2 savings today from BVG age credits (7/10/15/18% of the coordinated salary from 25), credited each year
 * at the BVG interest rate, on today's salary deflated with average wage growth for past years. Assumes an
 * uninterrupted career in Switzerland since 25.
 */
export function estimatePillar2(age: number, grossYear: number): number {
  let p2 = 0;
  for (let a = 25; a < age; a++) {
    const salary = grossYear / Math.pow(1 + ASSUMPTIONS.wageGrowth, age - a);
    p2 = p2 * (1 + ASSUMPTIONS.pillar2Rate) + bvgAgeCredit(a) * coordinatedSalary(salary);
  }
  return Math.round(p2 / 100) * 100;
}

/**
 * A retiree's reported income is a pension. Split it like the engine pays it — AHV (at most the maximum pension,
 * at least the minimum) plus a BVG annuity — and back out the pension-fund capital that the engine converts at
 * the retirement conversion rate, so the simulated income in month 0 equals the UBS figure.
 */
export function retireePension(netMonth: number, marginalTaxRate: number, age: number) {
  const retTax = effectiveTaxRate(marginalTaxRate) * RETIREMENT_TAX_FACTOR;
  const pensionGross = netMonth / (1 - retTax);
  const ahvFull = ahvMonthly(AHV_FULL_INCOME);
  const scale = Math.min(1, Math.max(0.5, Math.min(pensionGross, ahvFull) / ahvFull));
  // ahvMonthly() scales linearly from 50% at AHV_MIN_INCOME to 100% at AHV_FULL_INCOME.
  const formerGross = Math.round(AHV_MIN_INCOME + ((scale - 0.5) / 0.5) * (AHV_FULL_INCOME - AHV_MIN_INCOME));
  const ahv = ahvMonthly(formerGross);
  const conversion = bvgConversionRate(age);
  const pillar2 = Math.max(0, Math.round(((pensionGross - ahv) * 12) / conversion));
  return { formerGross, ahv, pillar2, conversion, retTax };
}

const round10 = (x: number) => Math.round(x / 10) * 10;
const ym = (iso: string) => Number(iso.slice(0, 4)) * 100 + Number(iso.slice(5, 7));
function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00Z");
  const b = new Date(toIso + "T00:00:00Z");
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() - a.getUTCDate()) / 30;
}
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function goalLabel(name: string, target: number, date: string): Msg {
  return { key: "ubs.goalLabel", params: { name: goalNameMsg(name), target, date: ym(date) } };
}

/** UBS loans with a payment: the data's, or the annuity over the default term when the data has 0. */
export function mapLiabilities(raw: UbsRawProfile): Liability[] {
  return raw.liabilities.map((l) => {
    const derived = !(l.monthlyPaymentChf > 0);
    return {
      id: l.id,
      kind: l.type === "mortgage" ? "mortgage" : "personal_loan",
      label: l.type === "mortgage" ? { key: "ubs.loanMortgage" } : { key: "ubs.loanPersonal" },
      principal: l.principalChf,
      annualRate: l.annualRate,
      // Exact annuity (not rounded), so the loan is repaid exactly at the end of the term; the UI rounds.
      monthlyPayment: derived ? annuityPayment(l.principalChf, l.annualRate, DEFAULT_LOAN_TERM_MONTHS) : l.monthlyPaymentChf,
      ...(derived ? { termMonths: DEFAULT_LOAN_TERM_MONTHS, paymentDerived: true } : {}),
    };
  });
}

/** All goals; the primary one (headline) has the highest priority, then the earliest date. */
export function mapGoals(raw: UbsRawProfile): ProfileGoal[] {
  const goals = raw.goals.map((g): ProfileGoal => {
    const years = Math.max(1, Math.round(monthsBetween(raw.asOf, g.targetDate) / 12));
    return {
      id: g.id,
      label: goalLabel(g.name, g.targetChf, g.targetDate),
      target: g.targetChf,
      age: raw.age + years,
      metric: GOAL_METRIC[g.name] ?? "netWorth",
      priority: g.priority,
      targetDate: g.targetDate,
    };
  });
  const order = [...goals].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.age - b.age || a.id.localeCompare(b.id),
  );
  if (order[0]) order[0].primary = true;
  return order;
}

export function mapUbsProfile(raw: UbsRawProfile): Profile {
  const retired = raw.employment === "retired";
  const marginalTaxRate = marginalTaxFor(raw.monthlyNetIncomeChf);
  const liabilities = mapLiabilities(raw);
  const debtService = liabilities.reduce((s, l) => s + l.monthlyPayment, 0);
  const disposable = Math.max(0, raw.monthlyNetIncomeChf - raw.monthlyRentChf - debtService);
  const minLiving = MIN_LIVING[raw.household] ?? MIN_LIVING.single;
  const expensesMonth = round10(raw.monthlyRentChf + Math.max(minLiving, (1 - SAVED_SHARE) * disposable));
  const selfEmployed = raw.employment === "self_employed";
  const unemployed = raw.employment === "unemployed";

  let grossIncomeYear: number;
  let pillar2: number;
  let retirementAge = DEFAULT_RETIREMENT_AGE;
  if (retired) {
    const pension = retireePension(raw.monthlyNetIncomeChf, marginalTaxRate, raw.age);
    grossIncomeYear = pension.formerGross;
    pillar2 = pension.pillar2;
    retirementAge = raw.age;
  } else {
    grossIncomeYear = grossFromNet(raw.monthlyNetIncomeChf, marginalTaxRate);
    // Unemployment benefits are 70% of the insured salary: estimate past pension savings on the former salary.
    pillar2 = selfEmployed ? 0 : estimatePillar2(raw.age, unemployed ? grossIncomeYear / 0.7 : grossIncomeYear);
  }
  const liquid = raw.cashChf + raw.investmentsChf;
  const investShare = liquid > 0 ? Math.round(Math.min(MAX_INVEST_SHARE, raw.investmentsChf / liquid) * 100) / 100 : 0;
  const goals = mapGoals(raw);
  const primary = goals.find((g) => g.primary);
  const goal = primary
    ? { label: primary.label, target: primary.target, age: primary.age, metric: primary.metric }
    : { label: { key: "profile.goalK", params: { target: 500_000, age: Math.max(50, raw.age + 10) } } as Msg, target: 500_000, age: Math.max(50, raw.age + 10) };

  const ubs: Provenance = "ubs_synthetic";
  const derived: Provenance = "derived";
  const dflt: Provenance = "doppel_default";
  return {
    id: raw.id,
    name: raw.name,
    age: raw.age,
    city: raw.city,
    canton: raw.canton,
    tagline: { key: "ubs.tagline", params: { employment: employmentMsg(raw.employment), household: householdMsg(raw.household) } },
    grossIncomeYear,
    netIncomeMonth: raw.monthlyNetIncomeChf,
    expensesMonth,
    rentMonth: raw.monthlyRentChf,
    // Other assets (none in the starter data) count as cash-like holdings.
    cash: raw.cashChf + raw.otherAssetsChf,
    portfolio: raw.investmentsChf,
    pillar2,
    pillar3a: 0,
    contributes3a: false,
    investShare,
    marginalTaxRate,
    riskProfile: retired ? RETIRED_RISK : DEFAULT_RISK,
    retirementAge,
    goal,
    goals,
    events: [],
    transactions: [],
    trades: [],
    history: { soldInDrawdown: false, drawdownSellPct: 0 },
    liabilities,
    ...(selfEmployed || unemployed ? { bvgInsured: false } : {}),
    asOf: raw.asOf,
    origin: { dataset: "ubs-lauzhack-2026", id: raw.id, employment: raw.employment, household: raw.household },
    provenance: {
      name: ubs,
      age: ubs,
      city: ubs,
      canton: ubs,
      employment: ubs,
      household: ubs,
      asOf: ubs,
      cash: ubs,
      portfolio: ubs,
      netIncomeMonth: ubs,
      rentMonth: ubs,
      liabilities: liabilities.length ? ubs : dflt,
      loanPayment: liabilities.some((l) => l.paymentDerived) ? derived : ubs,
      goals: goals.length ? ubs : dflt,
      goalMetric: dflt,
      grossIncomeYear: derived,
      pillar2: selfEmployed ? dflt : derived,
      bvgInsured: derived,
      expensesMonth: dflt,
      marginalTaxRate: dflt,
      pillar3a: dflt,
      contributes3a: dflt,
      investShare: derived,
      riskProfile: dflt,
      retirementAge: retired ? derived : dflt,
      transactions: dflt,
      history: dflt,
    },
  };
}

// ---------------- what the UI shows ----------------

export interface ProvenanceRow {
  field: string;
  provenance: Provenance;
  /** Display value: a CHF amount, a share, or text. */
  value: { chf: number } | { pct: number } | { text: Msg | string };
  note: Msg;
}

/** Inputs of a UBS profile, grouped by source, with the rule that produced each one. */
export function provenanceRows(p: Profile): ProvenanceRow[] {
  const prov = p.provenance ?? {};
  const loans = p.liabilities ?? [];
  const rows: ProvenanceRow[] = [
    { field: "cash", provenance: "ubs_synthetic", value: { chf: p.cash }, note: { key: "ubs.why.cash" } },
    { field: "portfolio", provenance: "ubs_synthetic", value: { chf: p.portfolio }, note: { key: "ubs.why.portfolio" } },
    { field: "netIncomeMonth", provenance: "ubs_synthetic", value: { chf: p.netIncomeMonth }, note: { key: "ubs.why.netIncome" } },
    { field: "rentMonth", provenance: "ubs_synthetic", value: { chf: p.rentMonth }, note: { key: "ubs.why.rent" } },
  ];
  if (loans.length) {
    rows.push({
      field: "liabilities",
      provenance: "ubs_synthetic",
      value: { chf: loans.reduce((s, l) => s + l.principal, 0) },
      note: { key: "ubs.why.liabilities" },
    });
    rows.push({
      field: "loanPayment",
      provenance: (prov.loanPayment as Provenance) ?? "ubs_synthetic",
      value: { chf: loans.reduce((s, l) => s + l.monthlyPayment, 0) },
      note: { key: "ubs.why.loanPayment", params: { months: DEFAULT_LOAN_TERM_MONTHS } },
    });
  }
  const retired = p.origin?.employment === "retired";
  rows.push(
    {
      field: "grossIncomeYear",
      provenance: "derived",
      value: { chf: p.grossIncomeYear },
      note: retired ? { key: "ubs.why.grossRetired" } : { key: "ubs.why.gross", params: { social: SOCIAL_DEDUCTIONS } },
    },
    {
      field: "pillar2",
      provenance: (prov.pillar2 as Provenance) ?? "derived",
      value: { chf: p.pillar2 },
      note:
        retired
          ? { key: "ubs.why.pillar2Retired" }
          : p.origin?.employment === "self_employed"
            ? { key: "ubs.why.pillar2Self" }
            : { key: "ubs.why.pillar2" },
    },
    { field: "investShare", provenance: "derived", value: { pct: p.investShare }, note: { key: "ubs.why.investShare" } },
    { field: "marginalTaxRate", provenance: "doppel_default", value: { pct: p.marginalTaxRate }, note: { key: "ubs.why.tax" } },
    {
      field: "expensesMonth",
      provenance: "doppel_default",
      value: { chf: p.expensesMonth },
      note: { key: "ubs.why.expenses", params: { spent: 1 - SAVED_SHARE, min: MIN_LIVING[p.origin?.household ?? "single"] ?? MIN_LIVING.single } },
    },
    { field: "pillar3a", provenance: "doppel_default", value: { chf: p.pillar3a }, note: { key: "ubs.why.pillar3a" } },
    { field: "riskProfile", provenance: "doppel_default", value: { text: { key: `risk.${p.riskProfile}` as MessageKey } }, note: { key: "ubs.why.risk" } },
    {
      field: "retirementAge",
      provenance: retired ? "derived" : "doppel_default",
      value: { text: String(p.retirementAge) },
      note: retired ? { key: "ubs.why.retiredAge" } : { key: "ubs.why.retirementAge" },
    },
    { field: "transactions", provenance: "doppel_default", value: { text: { key: "ubs.none" } }, note: { key: "ubs.why.transactions" } },
  );
  return rows;
}
