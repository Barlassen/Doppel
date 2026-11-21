import { simulate } from "./monteCarlo";
import { checkAffordability, projectedGross, projectedHardEquity } from "./swissRules";
import type { BehaviorParams, LifeEvent, Profile } from "./types";

export interface Recipe {
  id: "spend" | "invest" | "timing";
  title: string;
  detail: string;
  newProb: number;
  /** A patch the UI can apply with one click. */
  apply:
    | { kind: "expenseDelta"; value: number }
    | { kind: "optimize" }
    | { kind: "delay"; eventId: string; months: number };
}

const TARGET = 0.8;
const PATHS = 300;

/**
 * Inverse solver: searches the smallest lever that pushes the goal probability above 80%.
 * Pure maths on top of the Monte Carlo engine — no LLM involved.
 */
export function solveGoal(
  profile: Profile,
  events: LifeEvent[],
  behavior: BehaviorParams | undefined,
  base: { expenseDelta: number; optimize: boolean },
): Recipe[] {
  const run = (o: { expenseDelta?: number; optimize?: boolean; events?: LifeEvent[] }) =>
    simulate({
      profile,
      events: o.events ?? events,
      behavior,
      paths: PATHS,
      seed: 7,
      expenseDelta: o.expenseDelta ?? base.expenseDelta,
      optimizeIdleCash: o.optimize ?? base.optimize,
    }).successProb;

  const recipes: Recipe[] = [];
  const baseProb = run({});

  // 1) Spending lever: binary search the monthly cut (CHF 0..2500)
  if (baseProb < TARGET && run({ expenseDelta: base.expenseDelta - 2500 }) >= TARGET) {
    let lo = 0;
    let hi = 2500;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (run({ expenseDelta: base.expenseDelta - mid }) >= TARGET) hi = mid;
      else lo = mid;
    }
    const cut = Math.ceil(hi / 10) * 10;
    recipes.push({
      id: "spend",
      title: `Spend CHF ${cut.toLocaleString("de-CH")} less per month`,
      detail: `≈ CHF ${Math.round(cut / 30)} a day. Your payday-week dining is the easiest place to find it.`,
      newProb: run({ expenseDelta: base.expenseDelta - cut }),
      apply: { kind: "expenseDelta", value: base.expenseDelta - cut },
    });
  }

  // 2) Investment lever: put idle cash to work + max pillar 3a
  if (!base.optimize && baseProb < TARGET) {
    const prob = run({ optimize: true });
    const idle = Math.max(0, profile.cash - 3 * profile.expensesMonth);
    const taxSaving = profile.contributes3a ? 0 : Math.round(7258 * profile.marginalTaxRate);
    recipes.push({
      id: "invest",
      title: `Invest CHF ${Math.round(idle / 1000)}k idle cash${taxSaving ? " + max out 3a" : ""}`,
      detail: `Keep a 3-month buffer, invest the rest monthly${taxSaving ? `; 3a saves ~CHF ${taxSaving.toLocaleString("de-CH")} tax per year` : ""}.`,
      newProb: prob,
      apply: { kind: "optimize" },
    });
  }

  // 3) Timing lever: delay the house until it is affordable and the goal holds
  const house = events.find((e) => e.type === "house");
  const passesNow =
    house &&
    checkAffordability({
      price: house.amount,
      grossIncomeYear: projectedGross(profile.grossIncomeYear, house.month),
      hardEquityAvailable: projectedHardEquity(profile, house.month),
      pillar2Available: profile.pillar2,
    }).pass;
  if (house && !passesNow) {
    for (let d = 6; d <= 72; d += 6) {
      const shifted = events.map((e) => (e.id === house.id ? { ...e, month: e.month + d } : e));
      const at = house.month + d;
      const aff = checkAffordability({
        price: house.amount,
        grossIncomeYear: projectedGross(profile.grossIncomeYear, at),
        hardEquityAvailable: projectedHardEquity(profile, at),
        pillar2Available: profile.pillar2,
      });
      if (aff.pass) {
        const prob = run({ events: shifted });
        recipes.push({
          id: "timing",
          title: `Buy the home ${d} months later`,
          detail: `By then your savings and salary pass the bank's affordability test for ${house.label}.`,
          newProb: prob,
          apply: { kind: "delay", eventId: house.id, months: d },
        });
        break;
      }
    }
  }

  return recipes;
}
