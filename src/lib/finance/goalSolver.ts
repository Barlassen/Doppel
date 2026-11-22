import { simulate } from "./monteCarlo";
import { HEADLINE } from "./scenario";
import { debtSchedule, totalDebt } from "./debt";
import { BUFFER_MONTHS, PILLAR_3A_MAX } from "./swissRules";
import { carVsTransit } from "./life";
import type { LifeEvent, Scenario, SimInput, SimResult } from "./types";
import type { Msg } from "@/lib/i18n/types";

export interface Recipe {
  id: "spend" | "invest" | "timing" | "combo" | "debt";
  title: Msg;
  detail: Msg;
  /** Goal odds after applying the recipe — scored exactly like the headline (seed 42, 1,000 paths). */
  newProb: number;
  /** True when newProb ≥ 80%. Otherwise the UI must say "improves to X%", not "fixes". */
  reaches: boolean;
  /** A patch the UI can apply with one click. */
  apply:
    | { kind: "expenseDelta"; value: number }
    | { kind: "optimize" }
    | { kind: "delay"; eventId: string; months: number }
    | { kind: "combo"; eventId: string; months: number; expenseDelta: number }
    | { kind: "debtExtra"; value: number };
}

/**
 * The mobility lever: every car of the plan (bought or leased) is replaced by a GA travelcard from the same month.
 * Kept apart from `recipes` (its patch replaces events, which the `Recipe.apply` kinds cannot express); apply it
 * with `applyCarToGa()`.
 */
export interface CarToGaLever {
  id: "car_to_ga";
  title: Msg;
  detail: Msg;
  /** Goal odds with the lever — scored exactly like the headline (seed 42, 1,000 paths). */
  newProb: number;
  reaches: boolean;
  /** Monthly cost of the car(s) and of the GA(s) that replace them, today's CHF (TCS / SBB figures or the user's). */
  carMonthly: number;
  gaMonthly: number;
  /** The scenario's events with the cars replaced. */
  events: LifeEvent[];
}

export interface SolverResult {
  /** Headline odds of the scenario the solver started from (identical to the hero number). */
  baseProb: number;
  recipes: Recipe[];
  /** Only when the plan has a car and replacing it by a GA raises the odds. */
  carToGa?: CarToGaLever;
  ms: number;
}

/** The scenario with a `CarToGaLever` applied. Pure. */
export function applyCarToGa(s: Scenario, lever: CarToGaLever): Scenario {
  return { ...s, events: lever.events };
}

export const TARGET = 0.8;
/** Cheap search settings; every final recipe is re-scored with the HEADLINE settings. */
const SEARCH = { paths: 300, seed: 7 } as const;

/**
 * Inverse solver: searches the smallest lever that pushes the goal probability above 80%.
 * Pure maths on top of the Monte Carlo engine — no LLM involved. Search runs on 300 paths; the
 * winning recipe is then re-scored on the headline's 1,000 paths and seed, so "Apply" lands on
 * exactly the advertised number.
 */
export function solveGoal(base: SimInput, opts: { spendTip?: Msg } = {}): SolverResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const search = (patch: Partial<SimInput>): SimResult => simulate({ ...base, ...patch, ...SEARCH, horizon: "goal" });
  const score = (patch: Partial<SimInput>): SimResult => simulate({ ...base, ...patch, ...HEADLINE, horizon: "goal" });

  const baseRun = score({});
  const baseProb = baseRun.successProb;
  const recipes: Recipe[] = [];
  let carToGa: CarToGaLever | undefined;
  const done = (): SolverResult => ({ baseProb, recipes, ...(carToGa ? { carToGa } : {}), ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0 });
  if (baseProb >= TARGET) return done();

  const ed0 = base.expenseDelta ?? 0;
  const p = base.profile;

  /** Smallest monthly cut (CHF 0..2500) reaching the target, confirmed on the headline paths. */
  const MAX_CUT = 2500;
  const findCut = (patch: Partial<SimInput>): { cut: number; prob: number } | null => {
    if (search({ ...patch, expenseDelta: ed0 - MAX_CUT }).successProb < TARGET) return null;
    let lo = 0;
    let hi = MAX_CUT;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (search({ ...patch, expenseDelta: ed0 - mid }).successProb >= TARGET) hi = mid;
      else lo = mid;
    }
    let cut = Math.ceil(hi / 10) * 10;
    let prob = score({ ...patch, expenseDelta: ed0 - cut }).successProb;
    for (let i = 0; i < 5 && prob < TARGET; i++) {
      cut = Math.ceil((cut * 1.05) / 10) * 10;
      prob = score({ ...patch, expenseDelta: ed0 - cut }).successProb;
    }
    return { cut, prob };
  };

  // 1) Spending lever
  const spend = findCut({});
  if (spend) {
    recipes.push({
      id: "spend",
      title: { key: "recipe.spendTitle", params: { amount: spend.cut } },
      detail: opts.spendTip
        ? { key: "recipe.spendDetail", params: { daily: Math.round(spend.cut / 30), tip: opts.spendTip } }
        : { key: "recipe.spendDetailNoTip", params: { daily: Math.round(spend.cut / 30) } },
      newProb: spend.prob,
      reaches: spend.prob >= TARGET,
      apply: { kind: "expenseDelta", value: ed0 - spend.cut },
    });
  }

  // 2) Investment lever: put idle cash to work + max pillar 3a (skipped when it lowers the odds, e.g. a cash goal)
  if (!base.optimizeIdleCash) {
    const prob = score({ optimizeIdleCash: true }).successProb;
    if (prob >= baseProb) {
    const idle = Math.max(0, p.cash - BUFFER_MONTHS * (p.expensesMonth + ed0));
    const taxSaving = p.contributes3a ? 0 : Math.round(PILLAR_3A_MAX * p.marginalTaxRate);
    recipes.push({
      id: "invest",
      title: { key: taxSaving ? "recipe.investTitle3a" : "recipe.investTitle", params: { k: Math.round(idle / 1000) } },
      detail: taxSaving
        ? { key: "recipe.investDetail3a", params: { months: BUFFER_MONTHS, tax: taxSaving } }
        : { key: "recipe.investDetail", params: { months: BUFFER_MONTHS } },
      newProb: prob,
      reaches: prob >= TARGET,
      apply: { kind: "optimize" },
    });
    }
  }

  // 2b) Debt lever: an extra monthly payment on the loans (highest rate first). Debt service also counts in the
  //     bank test, so paying a loan off before a planned home purchase can make the mortgage affordable.
  const debt = totalDebt(p);
  if (debt > 0) {
    const ex0 = base.extraDebtPayment ?? 0;
    const MAX_EXTRA = 2000;
    const loans = p.liabilities ?? [];
    const months = Math.max(12, (p.goal.age - p.age) * 12);
    const interest = (extra: number) => debtSchedule(loans, 1200, extra).interestPaid;
    const push = (extra: number, prob: number, pass?: number) => {
      const s = debtSchedule(loans, 1200, ex0 + extra);
      recipes.push({
        id: "debt",
        title: { key: "ubs.recipeDebtTitle", params: { amount: extra } },
        detail: {
          key: pass === undefined ? "ubs.recipeDebtDetail" : "ubs.recipeDebtDetailHome",
          params: { saved: Math.max(0, Math.round(interest(ex0) - s.interestPaid)), months: s.debtFreeMonth ?? months, ...(pass === undefined ? {} : { pass }) },
        },
        newProb: prob,
        reaches: prob >= TARGET,
        apply: { kind: "debtExtra", value: ex0 + extra },
      });
    };
    const houseOf = (r: SimResult) => (house ? r.house?.boughtProb : undefined);
    const house = base.events.find((e) => e.type === "house");
    if (search({ extraDebtPayment: ex0 + MAX_EXTRA }).successProb >= TARGET) {
      let lo = 0;
      let hi = MAX_EXTRA;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (search({ extraDebtPayment: ex0 + mid }).successProb >= TARGET) hi = mid;
        else lo = mid;
      }
      let extra = Math.ceil(hi / 50) * 50;
      let r = score({ extraDebtPayment: ex0 + extra });
      for (let i = 0; i < 5 && r.successProb < TARGET; i++) {
        extra = Math.ceil((extra * 1.1) / 50) * 50;
        r = score({ extraDebtPayment: ex0 + extra });
      }
      push(extra, r.successProb, houseOf(r));
    } else {
      // No extra payment alone reaches the target: offer half of today's surplus (CHF 100–2,000) if it helps.
      const surplus = p.netIncomeMonth - p.expensesMonth - (p.liabilities ?? []).reduce((s, l) => s + l.monthlyPayment, 0);
      const extra = Math.min(MAX_EXTRA, Math.max(100, Math.round((surplus * 0.5) / 50) * 50));
      const r = score({ extraDebtPayment: ex0 + extra });
      if (r.successProb > baseProb || (houseOf(r) ?? 0) > (baseRun.house?.boughtProb ?? 0)) push(extra, r.successProb, houseOf(r));
    }
  }

  // 3) Timing lever: delay the home until the bank test passes in ≥ 80% of futures.
  const house = base.events.find((e) => e.type === "house");
  if (house && baseRun.house && baseRun.house.boughtProb < TARGET) {
    const shifted = (d: number) => base.events.map((e) => (e.id === house.id ? { ...e, month: e.month + d } : e));
    for (let d = 6; d <= 120; d += 6) {
      if ((search({ events: shifted(d) }).house?.boughtProb ?? 0) < TARGET) continue;
      const r = score({ events: shifted(d) });
      if ((r.house?.boughtProb ?? 0) < TARGET) continue;
      const pass = r.house?.boughtProb ?? 0;
      recipes.push({
        id: "timing",
        title: { key: "recipe.timingTitle", params: { months: d } },
        detail: { key: "recipe.timingDetail", params: { home: house.labelMsg ?? house.label, pass } },
        newProb: r.successProb,
        reaches: r.successProb >= TARGET,
        apply: { kind: "delay", eventId: house.id, months: d },
      });
      // Delay alone fixes the bank test but not the goal → combine it with the smallest spending cut.
      if (r.successProb < TARGET) {
        const combo = findCut({ events: shifted(d) });
        if (combo) {
          recipes.push({
            id: "combo",
            title: { key: "recipe.comboTitle", params: { months: d, amount: combo.cut } },
            detail: { key: "recipe.comboDetail", params: { pass } },
            newProb: combo.prob,
            reaches: combo.prob >= TARGET,
            apply: { kind: "combo", eventId: house.id, months: d, expenseDelta: ed0 - combo.cut },
          });
        }
      }
      break;
    }
  }

  // 4) Mobility lever: a GA travelcard instead of the plan's car(s).
  const cars = base.events.filter((e) => e.decision?.kind === "car" && e.decision.mode !== "ga");
  if (cars.length) {
    let carMonthly = 0;
    let gaMonthly = 0;
    const events = base.events.map((e): LifeEvent => {
      if (e.decision?.kind !== "car" || e.decision.mode === "ga") return e;
      const cost = carVsTransit(e.decision);
      carMonthly += cost.carMonthly;
      gaMonthly += cost.gaMonthly;
      const { replacesMonthly, durationMonths } = e.decision;
      return {
        ...e,
        type: "expense",
        amount: 0,
        label: "GA travelcard",
        labelMsg: { key: "life.event.ga" },
        source: "solver",
        decision: { kind: "car", mode: "ga", ...(replacesMonthly !== undefined ? { replacesMonthly } : {}), ...(durationMonths !== undefined ? { durationMonths } : {}) },
      };
    });
    const prob = score({ events }).successProb;
    if (prob > baseProb) {
      carToGa = {
        id: "car_to_ga",
        title: { key: "life.recipe.carToGaTitle" },
        detail: { key: "life.recipe.carToGaDetail", params: { car: Math.round(carMonthly), ga: Math.round(gaMonthly), saving: Math.round(carMonthly - gaMonthly) } },
        newProb: prob,
        reaches: prob >= TARGET,
        carMonthly,
        gaMonthly,
        events,
      };
    }
  }

  recipes.sort((a, b) => Number(b.reaches) - Number(a.reaches) || b.newProb - a.newProb);
  return done();
}
