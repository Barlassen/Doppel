/**
 * Life decisions in the game use the dashboard's sourced life-cost model: a "have a child" or "buy a car" card
 * costs what the same decision costs on the dashboard for the same person, because both call `compileLife`
 * (src/lib/finance/life.ts) with the parameter tables of src/lib/finance/params.ts.
 *
 * The engine's lines are per month in today's CHF. The game keeps them as a yearly schedule in CHF of the game's
 * start (`LifeCost` in state.ts): the mean of each twelve months, net of allowances and tax relief. Outcomes the
 * engine draws per future (a child's way to university or an apprenticeship from 16) enter at their expected value,
 * so that a position stays one deterministic state.
 */
import { compileLife } from "@/lib/finance/life";
import type { Decision, LifeEvent, Profile } from "@/lib/finance/types";
import type { GameState, LifeCost } from "./state";

/** The schedule covers the decision's whole life: a child until 25, a car until 80. */
const HORIZON_AGE = 100;

export interface LifeCostPlan {
  cost: LifeCost;
  /** Paid at once, start CHF: negative = cost (a car's purchase price). */
  upfront: number;
  /** Mean net cost per month over the first year and over the first ten years, start CHF (one-offs excluded). */
  firstYearMonthly: number;
  tenYearMonthly: number;
}

/** The person behind the position in CHF of the game's start (the model's parameters are in those CHF). */
function personOf(s: GameState): Profile {
  const k = s.priceIndex;
  return {
    id: s.profileId,
    name: s.name,
    age: s.age,
    city: s.city,
    canton: s.canton,
    tagline: { key: "profile.user.tagline" },
    grossIncomeYear: (s.pension ? 0 : s.gross) / k,
    netIncomeMonth: (s.pension ? 0 : s.net) / k,
    expensesMonth: s.expenses / k,
    rentMonth: s.rent / k,
    cash: s.cash / k,
    portfolio: s.portfolio / k,
    pillar2: s.pillar2 / k,
    pillar3a: s.pillar3a / k,
    contributes3a: s.contributes3a,
    investShare: s.investShare,
    marginalTaxRate: s.marginalTaxRate,
    riskProfile: s.riskProfile,
    retirementAge: s.pension ? Math.min(s.retirementAge, s.age) : s.retirementAge,
    goal: { label: { key: "profile.user.tagline" }, target: s.goal.target, age: s.goal.age },
    events: [],
    transactions: [],
    trades: [],
    history: { soldInDrawdown: false, drawdownSellPct: 0 },
  };
}

/**
 * The engine's cost model for one decision taken now. Children already in the game are passed along with their
 * age, so a second child costs what the engine says a second child costs.
 */
export function lifeCostPlan(s: GameState, id: string, kind: LifeCost["kind"], decision: Decision): LifeCostPlan {
  const p = personOf(s);
  const months = Math.max(12, (HORIZON_AGE - s.age) * 12);
  const retireMonth = Math.max(0, (p.retirementAge - s.age) * 12);
  const siblings: LifeEvent[] = (s.lifeCosts ?? [])
    .filter((c) => c.kind === "child")
    .map((c) => ({ id: c.id, type: "child", label: c.id, month: 0, amount: 0, decision: { kind: "child", ageYears: Math.max(0, s.turn - c.sinceTurn) } }));
  const event: LifeEvent = { id, type: kind === "child" ? "child" : "expense", label: id, month: 0, amount: 0, decision };
  const plan = compileLife(p, kind === "child" ? [...siblings, event] : [event], months, retireMonth);

  const net = new Float64Array(months);
  for (const l of plan.lines) {
    if (l.eventId !== id || l.structural) continue;
    const share = l.alt === undefined ? 1 : l.altWhen ? plan.alternatives[l.alt].prob : 1 - plan.alternatives[l.alt].prob;
    const sign = l.flow === "expense" ? 1 : -1;
    for (let m = 0; m < months; m++) net[m] += sign * share * l.monthly[m];
  }
  const monthly: number[] = [];
  for (let y = 0; y * 12 < months; y++) {
    let sum = 0;
    for (let m = y * 12; m < y * 12 + 12; m++) sum += net[m];
    monthly.push(sum / 12);
  }
  while (monthly.length && Math.abs(monthly[monthly.length - 1]) < 1e-9) monthly.pop();
  const ones = plan.oneOffs.filter((o) => o.eventId === id);
  const mean = (years: number) => monthly.slice(0, years).reduce((a, b) => a + b, 0) / years;
  return {
    cost: { id, kind, sinceTurn: s.turn, monthly, oneOffs: ones.filter((o) => o.month > 0).map((o) => ({ month: o.month, amount: o.amount })) },
    upfront: ones.filter((o) => o.month === 0).reduce((a, o) => a + o.amount, 0),
    firstYearMonthly: mean(1),
    tenYearMonthly: mean(10),
  };
}

export const withLifeCost = (s: GameState, cost: LifeCost) => void (s.lifeCosts = [...(s.lifeCosts ?? []), cost]);
export const withoutLifeCost = (s: GameState, kind: LifeCost["kind"]) => {
  const rest = (s.lifeCosts ?? []).filter((c) => c.kind !== kind);
  if (rest.length) s.lifeCosts = rest;
  else delete s.lifeCosts;
};
