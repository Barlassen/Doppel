import { simulate } from "./monteCarlo";
import { HEADLINE } from "./scenario";
import { BUFFER_MONTHS, PILLAR_3A_MAX } from "./swissRules";
import type { SimInput, SimResult } from "./types";
import type { Msg } from "@/lib/i18n/types";

export interface Recipe {
  id: "spend" | "invest" | "timing" | "combo";
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
    | { kind: "combo"; eventId: string; months: number; expenseDelta: number };
}

export interface SolverResult {
  /** Headline odds of the scenario the solver started from (identical to the hero number). */
  baseProb: number;
  recipes: Recipe[];
  ms: number;
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
  const done = () => ({ baseProb, recipes, ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0 });
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

  // 2) Investment lever: put idle cash to work + max pillar 3a
  if (!base.optimizeIdleCash) {
    const prob = score({ optimizeIdleCash: true }).successProb;
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

  recipes.sort((a, b) => Number(b.reaches) - Number(a.reaches) || b.newProb - a.newProb);
  return done();
}
