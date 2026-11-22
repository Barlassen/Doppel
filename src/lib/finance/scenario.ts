import { simulate } from "./monteCarlo";
import type { BehaviorParams, Profile, Scenario, SimInput } from "./types";
import type { Msg } from "@/lib/i18n/types";

/** Seed and path count of the headline odds. Everything that is compared to the headline uses these. */
export const HEADLINE = { seed: 42, paths: 1000 } as const;

export function baseScenario(p: Profile): Scenario {
  return { events: p.events, expenseDelta: 0, optimize: false, monthlyInvest: 0, income: null, recurring: [], extraTx: [] };
}

/** Profile with the scenario's overrides applied (income from a payslip, risk, 3a, retirement age, new recurring costs). */
export function effectiveProfile(p: Profile, s: Scenario): Profile {
  const recurring = s.recurring.reduce((sum, r) => sum + r.monthly, 0);
  return {
    ...p,
    grossIncomeYear: s.income?.grossIncomeYear ?? p.grossIncomeYear,
    netIncomeMonth: s.income?.netIncomeMonth ?? p.netIncomeMonth,
    expensesMonth: p.expensesMonth + recurring,
    riskProfile: s.riskProfile ?? p.riskProfile,
    contributes3a: s.contributes3a ?? p.contributes3a,
    retirementAge: s.retirementAge ?? p.retirementAge,
  };
}

/** The simulator input for a scenario (headline seed and paths unless overridden). */
export function simInputFor(p: Profile, s: Scenario, behavior?: BehaviorParams): SimInput {
  return {
    profile: effectiveProfile(p, s),
    events: s.events,
    behavior,
    expenseDelta: s.expenseDelta,
    optimizeIdleCash: s.optimize,
    monthlyInvest: s.monthlyInvest,
    ...(s.debtExtra ? { extraDebtPayment: s.debtExtra } : {}),
    ...(s.phases?.length ? { phases: s.phases } : {}),
    ...HEADLINE,
  };
}

export interface HabitCosts {
  /** Goal odds lost to payday / impulse spending (percentage points, ≥ 0 means it hurts). */
  leakagePp: number;
  /** Goal odds lost to panic selling. */
  panicPp: number;
}

/** Re-runs the real twin with one habit switched off at a time (same markets, cheap path count). */
export function habitCosts(input: SimInput): HabitCosts | null {
  const b = input.behavior;
  if (!b) return null;
  const run = (behavior: BehaviorParams) =>
    simulate({ ...input, behavior, paths: 500, seed: HEADLINE.seed, horizon: "goal" }).successProb;
  const base = run(b);
  return {
    leakagePp: (run({ ...b, leakageRate: 0 }) - base) * 100,
    panicPp: (run({ ...b, panicSellProb: 0 }) - base) * 100,
  };
}

export interface WaitingCost {
  label: Msg;
  startMonth: number;
  prob: number;
}

/**
 * Cost of waiting: goal odds if the idle cash is invested (and 3a maxed) now, in 2 years, in 5 years, or never.
 * Same seed and paths as the headline, so "now" equals the solver's invest recipe.
 */
export function costOfWaiting(input: SimInput): WaitingCost[] | null {
  if (input.optimizeIdleCash) return null;
  const run = (patch: Partial<SimInput>) => simulate({ ...input, ...HEADLINE, horizon: "goal", ...patch }).successProb;
  return [
    { label: { key: "waiting.now" }, startMonth: 0, prob: run({ optimizeIdleCash: true, optimizeFromMonth: 0 }) },
    { label: { key: "waiting.inYears", params: { count: 2 } }, startMonth: 24, prob: run({ optimizeIdleCash: true, optimizeFromMonth: 24 }) },
    { label: { key: "waiting.inYears", params: { count: 5 } }, startMonth: 60, prob: run({ optimizeIdleCash: true, optimizeFromMonth: 60 }) },
    { label: { key: "waiting.never" }, startMonth: -1, prob: run({}) },
  ];
}
