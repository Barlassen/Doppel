import { mulberry32, normalSampler } from "./rng";
import {
  MIN_EQUITY,
  MIN_HARD_EQUITY,
  PILLAR_3A_MAX,
  FIRST_MORTGAGE_SHARE,
  AMORTISATION_YEARS,
  ownershipMonthlyCost,
} from "./swissRules";
import type { LifeEvent, RiskProfile, SimInput, SimResult, YearBand } from "./types";

/** Capital-market assumptions (nominal, yearly). Deliberately conservative and documented. */
export const ASSUMPTIONS = {
  equity: { mu: 0.065, sigma: 0.16 },
  bonds: { mu: 0.02, sigma: 0.05 },
  cashRate: 0.003,
  inflation: 0.012,
  wageGrowth: 0.012,
  homeAppreciation: 0.015,
  pillar2Rate: 0.0125,
  pillar2ContribShare: 0.14, // employer + employee, share of gross
  unemploymentReplacement: 0.7,
  pensionReplacement: 0.6,
  crashShock: -0.3,
};

const EQUITY_WEIGHT: Record<RiskProfile, number> = {
  conservative: 0.3,
  balanced: 0.5,
  growth: 0.8,
};
const P3A_EQUITY_WEIGHT = 0.45;
const BUFFER_MONTHS = 3;

export function simulate(input: SimInput): SimResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { profile: p, behavior } = input;
  const paths = input.paths ?? 1000;
  const rand = mulberry32(input.seed ?? 42);
  const randn = normalSampler(rand);
  // Separate stream for behavioural coin-flips so "ideal" and "real" twins see the same markets.
  const behaviorRand = mulberry32((input.seed ?? 42) + 9973);

  const horizonYears = Math.min(40, Math.max(p.goal.age, p.retirementAge) - p.age);
  const months = horizonYears * 12;
  const goalMonth = Math.max(0, (p.goal.age - p.age) * 12);
  const retireMonth = (p.retirementAge - p.age) * 12;
  const wE = EQUITY_WEIGHT[p.riskProfile];
  const { equity: E, bonds: B } = ASSUMPTIONS;
  const sqrt12 = Math.sqrt(12);
  const monthlyInfl = Math.pow(1 + ASSUMPTIONS.inflation, 1 / 12);
  const monthlyWage = Math.pow(1 + ASSUMPTIONS.wageGrowth, 1 / 12);
  const monthlyHome = Math.pow(1 + ASSUMPTIONS.homeAppreciation, 1 / 12);
  const cashM = ASSUMPTIONS.cashRate / 12;
  const p2M = ASSUMPTIONS.pillar2Rate / 12;

  const events = [...input.events].sort((a, b) => a.month - b.month);
  const houses = events.filter((e) => e.type === "house");
  const crashMonths = new Set(events.filter((e) => e.type === "crash").map((e) => e.month));

  const optimize = !!input.optimizeIdleCash;
  const investShare = optimize ? 1 : p.investShare;
  const contributes3a = optimize || p.contributes3a;
  const leakage = behavior?.leakageRate ?? 0;

  const years = horizonYears;
  const nw = new Float64Array(paths * (years + 1));
  let successes = 0;
  let crunches = 0;
  const atGoal: number[] = [];

  for (let path = 0; path < paths; path++) {
    let cash = p.cash;
    let port = p.portfolio;
    let p3a = p.pillar3a;
    let p2 = p.pillar2;
    let homeValue = 0;
    let mortgage = 0;
    let ownCost = 0;
    let amortMonthly = 0;
    let mortgageFloor = 0;
    let owner = false;
    let houseFailed = false;
    let crunch = false;
    let idx = 1;
    let peak = 1;
    let panicLeft = 0;
    let episodeUsed = false;
    let p3aYear = 0;
    let wage = 1;
    let price = 1;

    if (optimize) {
      const buffer = BUFFER_MONTHS * p.expensesMonth;
      if (cash > buffer) {
        port += cash - buffer;
        cash = buffer;
      }
    }

    nw[path * (years + 1)] = cash + port + p3a + p2;

    for (let m = 0; m < months; m++) {
      // --- market draws (same draws used for both portfolios) ---
      let rE = E.mu / 12 + (E.sigma / sqrt12) * randn();
      const rB = B.mu / 12 + (B.sigma / sqrt12) * randn();
      if (crashMonths.has(m)) rE = ASSUMPTIONS.crashShock;
      idx *= 1 + rE;
      if (idx > peak) {
        peak = idx;
        episodeUsed = false;
      }

      // --- behavioural twin: panic selling in drawdowns ---
      if (behavior && panicLeft === 0 && !episodeUsed && 1 - idx / peak > 0.15) {
        episodeUsed = true;
        if (behaviorRand() < behavior.panicSellProb) panicLeft = behavior.panicOutMonths;
      }
      const portReturn = panicLeft > 0 ? cashM : wE * rE + (1 - wE) * rB;
      if (panicLeft > 0) panicLeft--;
      port *= 1 + portReturn;
      p3a *= 1 + (P3A_EQUITY_WEIGHT * rE + (1 - P3A_EQUITY_WEIGHT) * rB);
      p2 *= 1 + p2M;
      cash *= 1 + (cash > 0 ? cashM : 0.005);

      wage *= monthlyWage;
      price *= monthlyInfl;
      if (owner) {
        homeValue *= monthlyHome;
      }

      // --- income ---
      let income = m < retireMonth ? p.netIncomeMonth * wage : p.netIncomeMonth * wage * ASSUMPTIONS.pensionReplacement;
      let expenses = (p.expensesMonth + (input.expenseDelta ?? 0)) * price;
      let gross = p.grossIncomeYear * wage;

      for (const e of events) {
        if (e.type === "jobloss" && m >= e.month && m < e.month + (e.durationMonths ?? 6)) {
          income *= ASSUMPTIONS.unemploymentReplacement;
          gross *= ASSUMPTIONS.unemploymentReplacement;
        } else if (e.type === "raise" && m >= e.month) {
          income += ((e.amount * 0.72) / 12) * wage;
          gross += e.amount * wage;
        } else if (e.type === "child" && m >= e.month && m < e.month + (e.durationMonths ?? 216)) {
          expenses += e.amount * price;
        } else if (e.month === m && e.type === "expense") {
          cash -= e.amount;
        } else if (e.month === m && e.type === "income") {
          cash += e.amount;
        }
      }

      // --- house purchase ---
      for (const h of houses) {
        if (h.month !== m) continue;
        const equityNeed = h.amount * MIN_EQUITY;
        const liquid = Math.max(0, cash - p.expensesMonth) + port + p3a;
        const fromP2 = Math.min(p2, Math.max(0, equityNeed - liquid));
        if (Math.min(liquid, equityNeed) < h.amount * MIN_HARD_EQUITY || liquid + fromP2 < equityNeed) {
          houseFailed = true;
          continue;
        }
        let need = equityNeed - fromP2;
        p2 -= fromP2;
        const takeCash = Math.min(need, Math.max(0, cash - p.expensesMonth));
        cash -= takeCash;
        need -= takeCash;
        const takePort = Math.min(need, port);
        port -= takePort;
        need -= takePort;
        p3a -= need;
        owner = true;
        homeValue = h.amount;
        mortgage = h.amount - equityNeed;
        ownCost = ownershipMonthlyCost(h.amount, mortgage);
        mortgageFloor = h.amount * FIRST_MORTGAGE_SHARE;
        amortMonthly = Math.max(0, mortgage - mortgageFloor) / AMORTISATION_YEARS / 12;
      }
      if (owner) {
        expenses += ownCost - p.rentMonth * price;
        // amortisation is part of ownCost (cash out) and builds home equity
        if (mortgage > mortgageFloor) mortgage = Math.max(mortgageFloor, mortgage - amortMonthly);
      }

      // --- savings flow ---
      let surplus = income - expenses;
      if (surplus > 0 && leakage > 0) surplus *= 1 - leakage;

      if (m < retireMonth) {
        p2 += (gross * ASSUMPTIONS.pillar2ContribShare) / 12;
        if (contributes3a && surplus > 0) {
          const c = Math.min(PILLAR_3A_MAX / 12, surplus);
          p3a += c;
          p3aYear += c;
          surplus -= c;
        }
        if (m % 12 === 11) {
          cash += p3aYear * p.marginalTaxRate;
          p3aYear = 0;
        }
      }

      if (surplus > 0) {
        const inv = surplus * investShare;
        port += inv;
        cash += surplus - inv;
      } else {
        cash += surplus;
      }

      if (optimize) {
        const buffer = BUFFER_MONTHS * expenses;
        if (cash > buffer * 1.5) {
          port += cash - buffer;
          cash = buffer;
        }
      }

      if (cash < 0) {
        const sell = Math.min(port, -cash);
        port -= sell;
        cash += sell;
        if (cash < -1) crunch = true;
      }

      if (m % 12 === 11) {
        const y = (m + 1) / 12;
        const worth = cash + port + p3a + p2 + (owner ? homeValue - mortgage : 0);
        nw[path * (years + 1) + y] = worth / price;
      }
    }

    const gy = Math.min(years, Math.round(goalMonth / 12));
    const goalWorth = nw[path * (years + 1) + gy];
    atGoal.push(goalWorth);
    if (crunch) crunches++;
    if (!crunch && !houseFailed && goalWorth >= p.goal.target) successes++;
  }

  const bands: YearBand[] = [];
  const col = new Float64Array(paths);
  for (let y = 0; y <= years; y++) {
    for (let i = 0; i < paths; i++) col[i] = nw[i * (years + 1) + y];
    col.sort();
    bands.push({
      year: new Date().getFullYear() + y,
      age: p.age + y,
      p10: col[Math.floor(paths * 0.1)],
      p50: col[Math.floor(paths * 0.5)],
      p90: col[Math.floor(paths * 0.9)],
    });
  }
  atGoal.sort((a, b) => a - b);

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    bands,
    successProb: successes / paths,
    crunchProb: crunches / paths,
    medianAtGoal: atGoal[Math.floor(paths / 2)] ?? 0,
    goalMonth,
    ms: t1 - t0,
    paths,
  };
}

/** Helpers to move events in time without mutating. */
export function shiftEvent(events: LifeEvent[], id: string, deltaMonths: number): LifeEvent[] {
  return events.map((e) => (e.id === id ? { ...e, month: Math.max(0, e.month + deltaMonths) } : e));
}
