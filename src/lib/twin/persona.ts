/**
 * The twin's persona: who the twin is, in numbers. Pure and deterministic (0 tokens): identity, monthly money
 * facts, the balance sheet, behaviour traits with their evidence, a transparent financial health score and how much
 * of the twin is observed, entered or assumed.
 *
 * Every figure carries a provenance:
 *   derived        = observed in the person's statements (transactions, trades, or a statement summary)
 *   user           = entered by the person (the built-in accounts' hand-set values count as entered)
 *   ubs_synthetic  = given by the UBS synthetic dataset
 *   doppel_default = assumed or estimated by a Doppel rule
 *
 * The health score is a Doppel rule of thumb, not an official rating. Its benchmarks say whether they rest on a
 * sourced Swiss figure (`sourced: true`) or on a rule of thumb (`sourced: false`).
 */
import { analyzeBehavior } from "@/lib/finance/behavioralEngine";
import { netWorthOf, totalDebt } from "@/lib/finance/debt";
import { deriveInvestBehavior, healthPremiumOf } from "@/lib/finance/investBehavior";
import type { ParamProvenance } from "@/lib/finance/params";
import { bvgAgeCredit, coordinatedSalary } from "@/lib/finance/pension";
import { BUFFER_MONTHS, MAX_COST_TO_INCOME, PILLAR_3A_MAX, PILLAR_3A_MAX_NO_PENSION_FUND, PILLAR_3A_NO_PENSION_FUND_SHARE } from "@/lib/finance/swissRules";
import type { Profile } from "@/lib/finance/types";
import type { StatementSummary } from "@/lib/import";
import type { Msg } from "@/lib/i18n/types";

/* ------------------------------------------------------------------ benchmarks ------------------------------------------------------------------ */

/**
 * Health-score rules. None of these is an official rating; `sourced` marks the ones whose number is a Swiss legal
 * or regulatory figure already used elsewhere in the engine.
 */
export const HEALTH_RULES = {
  /** Months of spending in cash: `BUFFER_MONTHS` (the engine's buffer) is the lower end, full points at twice that. */
  bufferLow: BUFFER_MONTHS,
  bufferFull: BUFFER_MONTHS * 2,
  /** Share of take-home pay saved that earns full points (rule of thumb). */
  savingRateFull: 0.2,
  /** Housing share of take-home pay: full points up to one third, none from one half (rule of thumb). */
  housingFull: MAX_COST_TO_INCOME,
  housingZero: 0.5,
  /** Consumer-debt payments as a share of take-home pay at which the component reaches zero (rule of thumb). */
  debtZero: 0.3,
  /** Points per component. */
  max: 20,
} as const;

export type HealthId = "buffer" | "saving" | "housing" | "debt" | "retirement";
export const HEALTH_IDS: readonly HealthId[] = ["buffer", "saving", "housing", "debt", "retirement"];

export interface HealthComponent {
  id: HealthId;
  label: Msg;
  /** 0–20, an integer, so the five components add up to the score exactly. */
  points: number;
  max: number;
  /** The measured value (months or a share, see `unit`). */
  value: number;
  /** The value that earns full points. */
  benchmark: number;
  unit: "months" | "share";
  /** Short "value vs benchmark" text. */
  reading: Msg;
  /** One line: how the points are computed. */
  basis: Msg;
  /** Where the measured value comes from (the least certain of its inputs). */
  provenance: ParamProvenance;
  /** True = the benchmark is a sourced Swiss figure; false = a Doppel rule of thumb. */
  sourced: boolean;
  /** Name of the benchmark's source or rule. */
  benchmarkSource: Msg;
  /** False = the component cannot be measured for this person and holds neutral points. */
  applicable: boolean;
}

export type TraitId = "payday" | "steady" | "soldDrawdown" | "boughtDip" | "chasedPeak" | "subscriptions" | "uses3a" | "idleCash" | "leak";

export interface Trait {
  id: TraitId;
  label: Msg;
  /** The figure behind the trait. */
  evidence: Msg;
  /** Raw evidence number (a factor, a share, CHF or a count, depending on the trait). */
  value: number;
  tone: "good" | "warn" | "neutral";
}

export type LifeStage = "education" | "early" | "family" | "building" | "established" | "preRetirement" | "retired";
export type Household = "single" | "couple" | "family" | "shared";
export type MissingId = "statement" | "trades" | "pension" | "household" | "pillar3a" | "payslip";

export interface Figure {
  value: number;
  provenance: ParamProvenance;
}

export interface TwinPersona {
  identity: {
    name: string;
    age: number;
    city: string;
    canton: string;
    household: Household;
    householdLabel: Msg;
    householdProvenance: ParamProvenance;
    stage: LifeStage;
    stageLabel: Msg;
    yearsToRetirement: number;
  };
  /** CHF per month. */
  money: {
    takeHome: Figure;
    fixedCosts: Figure;
    /** Take-home pay minus fixed costs. */
    freeCash: Figure;
    /** Take-home pay minus all spending and loan payments (negative = spends more than comes in). */
    saved: Figure;
    /** Of `saved`: what goes into the broker account and pillar 3a. */
    invested: Figure;
    /** saved / take-home (0 without income). */
    savingRate: number;
  };
  balance: { cash: Figure; investments: Figure; pillar2: Figure; pillar3a: Figure; debt: Figure; netWorth: number };
  traits: Trait[];
  health: { score: number; max: number; components: HealthComponent[] };
  dataQuality: {
    /** Shares of the twin's inputs, summing to 1. `entered` includes data given by the UBS dataset. */
    observed: number;
    entered: number;
    assumed: number;
    /** Number of inputs counted. */
    fields: number;
    /** Most valuable missing inputs, most valuable first. */
    missing: { id: MissingId; label: Msg; action: Msg }[];
  };
}

/* ------------------------------------------------------------------ helpers ------------------------------------------------------------------ */

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const ratio = (a: number, b: number) => (b > 0 && Number.isFinite(a / b) ? a / b : 0);
const points = (f: number) => Math.round(clamp01(f) * HEALTH_RULES.max);

/** The least certain provenance wins: assumed, then dataset, then observed, then entered. */
function weakest(...list: ParamProvenance[]): ParamProvenance {
  for (const p of ["doppel_default", "ubs_synthetic", "derived", "user"] as const) if (list.includes(p)) return p;
  return "user";
}

const HOUSEHOLD: Record<string, Household> = { single: "single", couple: "couple", family: "family", shared_housing: "shared" };

function lifeStage(p: Profile, household: Household): LifeStage {
  const toRetirement = p.retirementAge - p.age;
  if (toRetirement <= 0 || p.origin?.employment === "retired") return "retired";
  if (p.origin?.employment === "student") return "education";
  if (toRetirement <= 10) return "preRetirement";
  if (household === "family") return "family";
  if (p.age < 30) return "early";
  return p.age < 50 ? "building" : "established";
}

/** BVG retirement assets a person of this age would hold from the legal age credits alone, at today's salary, without interest. */
export function bvgReference(age: number, grossIncomeYear: number, retirementAge: number): number {
  const coordinated = coordinatedSalary(grossIncomeYear);
  let credits = 0;
  for (let a = 25; a < Math.min(age, retirementAge); a++) credits += bvgAgeCredit(a);
  return coordinated * credits;
}

/* ------------------------------------------------------------------ persona ------------------------------------------------------------------ */

export function twinPersona(profile: Profile, summary?: StatementSummary): TwinPersona {
  const p = profile;
  const hasTx = p.transactions.length > 0;
  const hasTrades = p.trades.length > 0;
  const hasSummary = !!summary && summary.counts.rows > 0;
  const observedSpend = hasTx || (hasSummary && summary.counts.spend > 0);
  const observedIncome = hasSummary && summary.income.monthlyAvg > 0;

  /**
   * Provenance of a profile field. `statement` fields are observed when statements exist. Without statements, a value
   * the profile's own map calls "derived" was computed by a Doppel rule from other fields, so it counts as assumed.
   */
  const prov = (field: string, statement: "spend" | "trades" | "income" | null = null): ParamProvenance => {
    if (statement === "spend" && observedSpend) return "derived";
    if (statement === "trades" && hasTrades) return "derived";
    if (statement === "income" && observedIncome) return "derived";
    const given = p.provenance?.[field];
    if (given === "derived") return "doppel_default";
    return given ?? "user";
  };

  // ---- identity
  const householdKnown = p.origin?.household !== undefined && p.origin.household in HOUSEHOLD;
  const household: Household = householdKnown ? HOUSEHOLD[p.origin!.household] : "single";
  const householdProvenance: ParamProvenance = householdKnown ? prov("household") : "doppel_default";
  const stage = lifeStage(p, household);

  // ---- money per month
  const takeHome = Math.max(0, p.netIncomeMonth);
  const liabilities = p.liabilities ?? [];
  const mortgagePay = liabilities.filter((l) => l.kind === "mortgage").reduce((s, l) => s + Math.max(0, l.monthlyPayment), 0);
  const loanPay = liabilities.filter((l) => l.kind !== "mortgage").reduce((s, l) => s + Math.max(0, l.monthlyPayment), 0);
  const debtPay = mortgagePay + loanPay;
  const debtProv: ParamProvenance = liabilities.length ? weakest(prov("liabilities"), prov("loanPayment")) : prov("liabilities");

  const premium = healthPremiumOf(p);
  const months = new Set(p.transactions.map((t) => t.date.slice(0, 7))).size || 1;
  const monthlyOf = (...cats: string[]) => p.transactions.filter((t) => cats.includes(t.category)).reduce((s, t) => s + t.amount, 0) / months;
  let fixedBase: number;
  let fixedProv: ParamProvenance;
  if (hasSummary && summary.fixed.monthlyTotal > 0) {
    fixedBase = summary.fixed.monthlyTotal;
    fixedProv = "derived";
  } else if (hasTx) {
    fixedBase = monthlyOf("housing", "insurance", "bills", "subscriptions");
    fixedProv = "derived";
  } else {
    fixedBase = p.rentMonth + premium.value;
    fixedProv = weakest(prov("rentMonth"), premium.provenance);
  }
  const fixedCosts = fixedBase + debtPay;
  if (debtPay > 0) fixedProv = weakest(fixedProv, debtProv);

  const incomeProv = prov("netIncomeMonth", "income");
  const spendProv = prov("expensesMonth", "spend");
  const saved = takeHome - p.expensesMonth - debtPay;
  const savedProv = weakest(incomeProv, spendProv, ...(debtPay > 0 ? [debtProv] : []));
  const savingRate = ratio(saved, takeHome);

  const inv = hasTrades || hasTx ? deriveInvestBehavior({ netIncomeMonth: p.netIncomeMonth, transactions: p.transactions, trades: p.trades }) : null;
  const invested = hasTrades && inv ? Math.max(0, inv.brokerNetMonth) + inv.p3aMonth : Math.max(0, saved) * clamp01(p.investShare);
  const investedProv: ParamProvenance = hasTrades ? "derived" : weakest(savedProv, prov("investShare", "trades"));

  // ---- balance sheet
  const debt = totalDebt(p);
  const balance = {
    cash: { value: p.cash, provenance: prov("cash") },
    investments: { value: p.portfolio, provenance: prov("portfolio") },
    pillar2: { value: p.pillar2, provenance: prov("pillar2") },
    pillar3a: { value: p.pillar3a, provenance: prov("pillar3a") },
    debt: { value: debt, provenance: prov("liabilities") },
    netWorth: netWorthOf(p),
  };

  // ---- health score
  const R = HEALTH_RULES;
  const rule: Msg = { key: "twin.source.rule" };

  const spendAll = p.expensesMonth + debtPay;
  const bufferMonths = ratio(p.cash, spendAll);
  const buffer: HealthComponent = {
    id: "buffer",
    label: { key: "twin.health.buffer.label" },
    points: points(spendAll > 0 ? bufferMonths / R.bufferFull : p.cash > 0 ? 1 : 0),
    max: R.max,
    value: bufferMonths,
    benchmark: R.bufferFull,
    unit: "months",
    reading: { key: "twin.health.buffer.reading", params: { value: bufferMonths, low: R.bufferLow, full: R.bufferFull } },
    basis: { key: "twin.health.buffer.basis", params: { cash: p.cash, spend: spendAll, full: R.bufferFull } },
    provenance: weakest(prov("cash"), spendProv),
    sourced: false,
    benchmarkSource: rule,
    applicable: true,
  };

  const saving: HealthComponent = {
    id: "saving",
    label: { key: "twin.health.saving.label" },
    points: points(savingRate / R.savingRateFull),
    max: R.max,
    value: savingRate,
    benchmark: R.savingRateFull,
    unit: "share",
    reading: { key: "twin.health.saving.reading", params: { value: savingRate, full: R.savingRateFull } },
    basis: { key: "twin.health.saving.basis", params: { saved, income: takeHome, full: R.savingRateFull } },
    provenance: savedProv,
    sourced: false,
    benchmarkSource: rule,
    applicable: takeHome > 0,
  };

  const housingCost = p.rentMonth + mortgagePay;
  const housingShare = ratio(housingCost, takeHome);
  const housingF = takeHome <= 0 ? (housingCost > 0 ? 0 : 1) : 1 - (housingShare - R.housingFull) / (R.housingZero - R.housingFull);
  const housing: HealthComponent = {
    id: "housing",
    label: { key: "twin.health.housing.label" },
    points: points(housingF),
    max: R.max,
    value: housingShare,
    benchmark: R.housingFull,
    unit: "share",
    reading: { key: "twin.health.housing.reading", params: { value: housingShare, full: R.housingFull } },
    basis: { key: "twin.health.housing.basis", params: { cost: housingCost, income: takeHome, full: R.housingFull, zero: R.housingZero } },
    provenance: weakest(prov("rentMonth", "spend"), incomeProv, ...(mortgagePay > 0 ? [debtProv] : [])),
    sourced: false,
    benchmarkSource: rule,
    applicable: true,
  };

  const debtShare = ratio(loanPay, takeHome);
  const debtF = takeHome <= 0 ? (loanPay > 0 ? 0 : 1) : 1 - debtShare / R.debtZero;
  const debtC: HealthComponent = {
    id: "debt",
    label: { key: "twin.health.debt.label" },
    points: points(debtF),
    max: R.max,
    value: debtShare,
    benchmark: 0,
    unit: "share",
    reading: { key: "twin.health.debt.reading", params: { value: debtShare, zero: R.debtZero } },
    basis: { key: "twin.health.debt.basis", params: { pay: loanPay, income: takeHome, zero: R.debtZero, debt } },
    provenance: loanPay > 0 ? weakest(debtProv, incomeProv) : prov("liabilities"),
    sourced: false,
    benchmarkSource: rule,
    applicable: true,
  };

  // Retirement: half pillar 3a use (legal maximum), half pillar 2 against the legal age credits.
  // A retired person no longer builds either pillar, so the component is not measured (neutral 10 points).
  const working = stage !== "retired" && takeHome > 0;
  const p3aMax = p.bvgInsured === false ? Math.min(PILLAR_3A_MAX_NO_PENSION_FUND, PILLAR_3A_NO_PENSION_FUND_SHARE * takeHome * 12) : PILLAR_3A_MAX;
  const p3aYear = hasTrades && inv ? inv.p3aMonth * 12 : p.contributes3a ? p3aMax : 0;
  const p3aUse = clamp01(ratio(p3aYear, p3aMax));
  const p3aApplies = working && p3aMax > 0;
  const p2Ref = p.bvgInsured === false ? 0 : bvgReference(p.age, p.grossIncomeYear, p.retirementAge);
  const p2Track = clamp01(ratio(p.pillar2, p2Ref));
  const p2Applies = stage !== "retired" && p2Ref > 0;
  const retirementF = p3aApplies && p2Applies ? (p3aUse + p2Track) / 2 : p3aApplies ? p3aUse : p2Applies ? p2Track : 0.5;
  const retirementApplies = p3aApplies || p2Applies;
  const retirement: HealthComponent = {
    id: "retirement",
    label: { key: "twin.health.retirement.label" },
    points: points(retirementF),
    max: R.max,
    value: retirementF,
    benchmark: 1,
    unit: "share",
    reading: !retirementApplies
      ? { key: "twin.health.retirement.readingNone" }
      : p3aApplies && p2Applies
        ? { key: "twin.health.retirement.reading", params: { use: p3aUse, track: p2Track } }
        : p3aApplies
          ? { key: "twin.health.retirement.reading3a", params: { use: p3aUse } }
          : { key: "twin.health.retirement.readingP2", params: { track: p2Track } },
    basis: !retirementApplies
      ? { key: "twin.health.retirement.basisNone" }
      : { key: "twin.health.retirement.basis", params: { paid: p3aApplies ? p3aYear : 0, max: p3aMax, p2: p.pillar2, ref: p2Ref } },
    provenance: !retirementApplies
      ? "doppel_default"
      : weakest(...(p3aApplies ? [prov("contributes3a", "trades")] : []), ...(p2Applies ? [prov("pillar2"), prov("grossIncomeYear")] : [])),
    sourced: retirementApplies,
    benchmarkSource: retirementApplies ? { key: "twin.source.pension" } : rule,
    applicable: retirementApplies,
  };

  const components = [buffer, saving, housing, debtC, retirement];
  const score = components.reduce((s, c) => s + c.points, 0);

  // ---- behaviour traits (only from observed data)
  const traits: Trait[] = [];
  const trait = (id: TraitId, tone: Trait["tone"], value: number, params: Record<string, number>) =>
    traits.push({ id, tone, value, label: { key: `twin.trait.${id}.label` }, evidence: { key: `twin.trait.${id}.evidence`, params } });
  if (hasTrades && inv) {
    if (inv.soldInDrawdown) trait("soldDrawdown", "warn", inv.drawdownSellPct, { share: inv.drawdownSellPct });
    if (inv.months >= 2 && inv.buyMonths / inv.months >= 0.8) trait("steady", "good", inv.buyMonths, { n: inv.buyMonths, m: inv.months });
    if (inv.dip) trait("boughtDip", "good", inv.dip.amount, { amount: inv.dip.amount });
    if (inv.chase) trait("chasedPeak", "warn", inv.chase.drop, { drop: inv.chase.drop });
  }
  if (hasTx) {
    const beh = analyzeBehavior(p);
    if (beh.paydaySpike > 1.25) trait("payday", "warn", beh.paydaySpike, { x: beh.paydaySpike });
    if (hasTrades && inv && inv.contributes3a && inv.p3aMonth > 0) trait("uses3a", "good", inv.p3aMonth * 12, { amount: inv.p3aMonth * 12 });
    if (beh.subscriptions.length >= 2) {
      const monthly = beh.subscriptions.reduce((s, x) => s + x.monthly, 0);
      trait("subscriptions", "neutral", monthly, { n: beh.subscriptions.length, monthly });
    }
    if (bufferMonths > R.bufferFull && p.investShare < 0.25) trait("idleCash", "neutral", bufferMonths, { months: bufferMonths });
    if (beh.leakageChfMonth > 0) trait("leak", "neutral", beh.leakageChfMonth, { amount: beh.leakageChfMonth });
  }

  // ---- how well the twin knows the person
  const fields: ParamProvenance[] = [
    prov("age"),
    prov("canton"),
    householdProvenance,
    prov("grossIncomeYear", "income"),
    incomeProv,
    spendProv,
    prov("rentMonth", "spend"),
    premium.provenance,
    prov("cash"),
    prov("portfolio"),
    prov("pillar2"),
    prov("pillar3a"),
    prov("contributes3a", "trades"),
    prov("investShare", "trades"),
    prov("history", "trades"),
    prov("liabilities"),
    prov("marginalTaxRate"),
    prov("riskProfile"),
    prov("retirementAge"),
    // Spending habits (payday pattern, subscriptions, leakage) exist only with transactions.
    hasTx ? "derived" : "doppel_default",
  ];
  const n = fields.length;
  const observedN = fields.filter((f) => f === "derived").length;
  const assumedN = fields.filter((f) => f === "doppel_default").length;
  const observed = observedN / n;
  const assumed = assumedN / n;
  const entered = 1 - observed - assumed;

  const missing: TwinPersona["dataQuality"]["missing"] = [];
  const miss = (id: MissingId) => missing.push({ id, label: { key: `twin.missing.${id}.label` }, action: { key: `twin.missing.${id}.action` } });
  if (!observedSpend) miss("statement");
  if (!hasTrades && p.portfolio + p.pillar3a > 0) miss("trades");
  if (prov("pillar2") === "doppel_default") miss("pension");
  if (householdProvenance === "doppel_default") miss("household");
  if (prov("pillar3a") === "doppel_default") miss("pillar3a");
  if (prov("marginalTaxRate") === "doppel_default" || prov("grossIncomeYear") === "doppel_default") miss("payslip");
  if (!hasTrades && !missing.some((m) => m.id === "trades")) miss("trades");

  return {
    identity: {
      name: p.name,
      age: p.age,
      city: p.city,
      canton: p.canton,
      household,
      householdLabel: { key: `twin.household.${household}` },
      householdProvenance,
      stage,
      stageLabel: { key: `twin.stage.${stage}` },
      yearsToRetirement: Math.max(0, p.retirementAge - p.age),
    },
    money: {
      takeHome: { value: takeHome, provenance: incomeProv },
      fixedCosts: { value: fixedCosts, provenance: fixedProv },
      freeCash: { value: takeHome - fixedCosts, provenance: weakest(incomeProv, fixedProv) },
      saved: { value: saved, provenance: savedProv },
      invested: { value: invested, provenance: investedProv },
      savingRate,
    },
    balance,
    traits,
    health: { score, max: R.max * components.length, components },
    dataQuality: { observed, entered, assumed, fields: n, missing },
  };
}
