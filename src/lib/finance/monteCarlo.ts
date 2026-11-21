import { mulberry32, normalSampler } from "./rng";
import {
  ACTUAL_MORTGAGE_RATE,
  AMORTISATION_YEARS,
  BUFFER_MONTHS,
  FIRST_MORTGAGE_SHARE,
  MAINTENANCE_RATE,
  PILLAR_3A_MAX,
  closingCostRate,
  tragbarkeit,
} from "./swissRules";
import {
  AHV_AGE,
  P3A_EARLIEST_AGE,
  P3A_PAYOUT_TAX,
  RETIREMENT_TAX_FACTOR,
  ahvMonthly,
  bvgAgeCredit,
  bvgConversionRate,
  coordinatedSalary,
  effectiveTaxRate,
} from "./pension";
import type { HouseStats, LifeEvent, RetirementStats, RiskProfile, SimInput, SimResult, YearBand } from "./types";

/** Yearly nominal capital-market and household assumptions. */
export const ASSUMPTIONS = {
  equity: { mu: 0.065, sigma: 0.16 },
  bonds: { mu: 0.02, sigma: 0.05 },
  cashRate: 0.003,
  overdraftRate: 0.06,
  inflation: 0.012,
  wageGrowth: 0.012,
  /** Swiss residential property: +1.5%/yr on average, 5% yearly volatility. */
  home: { mu: 0.015, sigma: 0.05 },
  /** Career luck: yearly volatility of real wage growth (promotions, job changes, stagnation). */
  wageVol: 0.01,
  pillar2Rate: 0.0125,
  unemploymentReplacement: 0.7,
  /** Maximum insured salary for unemployment insurance (CHF/yr). */
  unemploymentInsuredCap: 148_200,
  crashShock: -0.3,
  /** Non-housing spending in retirement vs. working life. */
  retirementSpending: 0.8,
  endAge: 90,
  /** Share of a gross raise that reaches the bank account. */
  raiseNetShare: 0.72,
  /** Market drawdown that can trigger a panic sale. */
  panicDrawdown: 0.15,
};

export const EQUITY_WEIGHT: Record<RiskProfile, number> = {
  conservative: 0.3,
  balanced: 0.5,
  growth: 0.8,
};
const P3A_EQUITY_WEIGHT = 0.45;

/** Independent, reproducible random stream per path (so truncated runs and scenarios share the same markets). */
function pathSeed(seed: number, path: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(path + 1, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Monte Carlo twin. Monthly steps from today to age 90:
 *  working life  → salary, BVG age credits, 3a, savings behaviour, life events, home purchase (bank test at the date)
 *  retirement    → BVG annuity (pillar 2 × conversion rate) + AHV from 65 (bridged from savings if earlier),
 *                  spending ×0.8 (housing unchanged), liquid savings drawn down until they run out.
 */
export function simulate(input: SimInput): SimResult {
  const t0 = now();
  const { profile: p, behavior } = input;
  const paths = input.paths ?? 1000;
  const seed = input.seed ?? 42;
  const A = ASSUMPTIONS;

  const endAge = Math.max(A.endAge, p.retirementAge + 1, p.goal.age + 1);
  const fullMonths = (endAge - p.age) * 12;
  const goalYear = Math.max(0, p.goal.age - p.age);
  const goalMonth = goalYear * 12;
  const events = [...input.events].sort((a, b) => a.month - b.month);
  const house = events.find((e) => e.type === "house");
  const months =
    input.horizon === "goal"
      ? Math.min(fullMonths, Math.max(goalMonth, house ? Math.ceil((house.month + 1) / 12) * 12 : 0, 12))
      : fullMonths;
  const years = months / 12;
  const full = months === fullMonths;

  const retireMonth = Math.max(0, (p.retirementAge - p.age) * 12);
  const ahvMonth = (Math.max(AHV_AGE, p.retirementAge) - p.age) * 12;
  const p3aPayoutMonth = Math.max(retireMonth, (P3A_EARLIEST_AGE - p.age) * 12);
  const conversion = bvgConversionRate(p.retirementAge);
  const ahvToday = ahvMonthly(p.grossIncomeYear);
  const retTax = effectiveTaxRate(p.marginalTaxRate) * RETIREMENT_TAX_FACTOR;
  const closingRate = closingCostRate(p.canton);

  const wE = EQUITY_WEIGHT[p.riskProfile];
  const { equity: E, bonds: B } = A;
  const sqrt12 = Math.sqrt(12);
  const eMu = E.mu / 12;
  const eSd = E.sigma / sqrt12;
  const bMu = B.mu / 12;
  const bSd = B.sigma / sqrt12;
  const cashM = A.cashRate / 12;
  const overdraftM = A.overdraftRate / 12;
  const p2M = A.pillar2Rate / 12;
  const hMu = A.home.mu / 12;
  const hSd = A.home.sigma / sqrt12;
  const wageDrift = -0.5 * A.wageVol * A.wageVol;

  const optimize = !!input.optimizeIdleCash;
  const optFrom = optimize ? Math.max(0, Math.round(input.optimizeFromMonth ?? 0)) : Infinity;
  const leakage = behavior?.leakageRate ?? 0;
  const monthlyInvest = Math.max(0, input.monthlyInvest ?? 0);
  const baseMonthly = Math.max(p.rentMonth, p.expensesMonth + (input.expenseDelta ?? 0));

  // ---------- path-independent monthly schedule (salary, spending, events) ----------
  const priceIdx = new Float64Array(months);
  const netIncome = new Float64Array(months);
  const grossInc = new Float64Array(months);
  const p2Credit = new Float64Array(months);
  const baseExp = new Float64Array(months);
  const rentArr = new Float64Array(months);
  const oneOff = new Float64Array(months);
  const crash = new Uint8Array(months);
  {
    let wage = 1;
    let price = 1;
    const mWage = Math.pow(1 + A.wageGrowth, 1 / 12);
    const mInfl = Math.pow(1 + A.inflation, 1 / 12);
    for (let m = 0; m < months; m++) {
      wage *= mWage;
      price *= mInfl;
      priceIdx[m] = price;
      const retired = m >= retireMonth;
      let gross = p.grossIncomeYear * wage;
      let net = p.netIncomeMonth * wage;
      let unemployed = false;
      let child = 0;
      for (const e of events) {
        if (e.type === "jobloss" && m >= e.month && m < e.month + (e.durationMonths ?? 6)) unemployed = true;
        else if (e.type === "raise" && m >= e.month) {
          gross += e.amount * wage;
          net += ((e.amount * A.raiseNetShare) / 12) * wage;
        } else if (e.type === "child" && m >= e.month && m < e.month + (e.durationMonths ?? 216)) child += e.amount * price;
        else if (e.type === "crash" && e.month === m) crash[m] = 1;
        else if (e.type === "expense" && e.month === m) oneOff[m] -= e.amount;
        else if (e.type === "income" && e.month === m) oneOff[m] += e.amount;
      }
      if (unemployed) {
        // 70% of the insured salary, capped at CHF 148,200/yr.
        const f = gross > 0 ? A.unemploymentReplacement * Math.min(1, (A.unemploymentInsuredCap * wage) / gross) : 0;
        net *= f;
        gross *= f;
      }
      const ageNow = p.age + Math.floor(m / 12);
      netIncome[m] = retired ? 0 : net;
      grossInc[m] = retired ? 0 : gross;
      // BVG savings credits stop during unemployment (ALV only insures death & disability).
      p2Credit[m] = retired || unemployed ? 0 : (bvgAgeCredit(ageNow) * coordinatedSalary(gross / wage) * wage) / 12;
      const living = retired ? (baseMonthly - p.rentMonth) * A.retirementSpending + p.rentMonth : baseMonthly;
      baseExp[m] = living * price + child;
      rentArr[m] = p.rentMonth * price;
    }
  }

  const nw = new Float64Array(paths * (years + 1));
  let successes = 0;
  let crunches = 0;
  const atGoal = new Float64Array(paths);
  // house stats
  let bought = 0;
  const hardAtPurchase: number[] = [];
  const p2AtPurchase: number[] = [];
  const grossAtPurchase: number[] = [];
  const equityIn: number[] = [];
  const loans: number[] = [];
  // retirement stats
  const depletion = new Float64Array(paths).fill(Infinity);
  const liquidAtRet: number[] = [];
  const bvgReal: number[] = [];
  const spendRet: number[] = [];

  for (let path = 0; path < paths; path++) {
    const ps = pathSeed(seed, path);
    const randn = normalSampler(mulberry32(ps));
    // Separate stream for behavioural coin-flips so "ideal" and "real" twins see the same markets.
    const brand = mulberry32(ps ^ 0x5bd1e995);

    let cash = p.cash;
    let port = p.portfolio;
    let parked = 0; // panic-sold money waiting in cash
    let p3a = p.pillar3a;
    let p2 = p.pillar2;
    let homeValue = 0;
    let mortgage = 0;
    let amortMonthly = 0;
    let mortgageFloor = 0;
    let owner = false;
    let houseFailed = false;
    let crunch = false;
    let idx = 1;
    let peak = 1;
    let episodeUsed = false;
    let reentryLevel = 0;
    let outMonths = 0;
    let p3aYear = 0;
    let wf = 1; // this future's career factor on top of average wage growth
    let bvgMonthly = 0;
    let p2AtRet = 0;

    const row = path * (years + 1);
    nw[row] = cash + port + p3a + p2;

    for (let m = 0; m < months; m++) {
      const price = priceIdx[m];
      const optimizing = m >= optFrom;
      if (m === optFrom) {
        const buffer = BUFFER_MONTHS * baseExp[m];
        if (cash > buffer) {
          port += cash - buffer;
          cash = buffer;
        }
      }

      // --- markets (same draws for every scenario on this path) ---
      const rE = crash[m] ? A.crashShock : eMu + eSd * randn();
      const rB = bMu + bSd * randn();
      const rH = hMu + hSd * randn();
      if (m % 12 === 0) {
        const z = randn();
        if (m > 0) wf *= Math.exp(A.wageVol * z + wageDrift);
      }
      idx *= 1 + rE;
      if (idx > peak) {
        peak = idx;
        episodeUsed = false;
      }
      port *= 1 + wE * rE + (1 - wE) * rB;
      parked *= 1 + cashM;
      p3a *= 1 + P3A_EQUITY_WEIGHT * rE + (1 - P3A_EQUITY_WEIGHT) * rB;
      if (m < retireMonth) p2 *= 1 + p2M;
      cash *= 1 + (cash > 0 ? cashM : overdraftM);
      if (owner) homeValue *= 1 + rH;

      // --- behavioural twin: panic selling at the bottom, buying back only after the recovery ---
      if (parked > 0) {
        outMonths++;
        if (outMonths >= (behavior?.panicOutMonths ?? 6) && idx >= reentryLevel) {
          port += parked;
          parked = 0;
        }
      } else if (behavior && !episodeUsed && idx < peak * (1 - A.panicDrawdown)) {
        episodeUsed = true;
        if (brand() < behavior.panicSellProb) {
          const sold = port * behavior.panicSellShare;
          port -= sold;
          parked = sold;
          reentryLevel = peak;
          outMonths = 0;
        }
      }

      // --- retirement transition ---
      if (m === retireMonth) {
        liquidAtRet.push((cash + port + parked + p3a) / price);
        p2AtRet = p2;
        bvgMonthly = (p2 * conversion) / 12;
        bvgReal.push(bvgMonthly / price);
        p2 = 0;
      }
      if (m === p3aPayoutMonth && p3a > 0) {
        port += p3a * (1 - P3A_PAYOUT_TAX);
        p3a = 0;
      }

      // --- income & spending ---
      const retired = m >= retireMonth;
      const income = retired ? (bvgMonthly + (m >= ahvMonth ? ahvToday * price : 0)) * (1 - retTax) : netIncome[m] * wf;
      let expenses = baseExp[m];
      cash += oneOff[m];

      // --- home purchase: the bank test runs at the purchase date with this future's equity & salary ---
      if (house && m === house.month) {
        const buffer = BUFFER_MONTHS * expenses;
        const hardAvail = Math.max(0, cash - buffer) + parked + port + p3a;
        const gross = retired ? (bvgMonthly + (m >= ahvMonth ? ahvToday * price : 0)) * 12 : grossInc[m] * wf;
        hardAtPurchase.push(hardAvail);
        grossAtPurchase.push(gross);
        p2AtPurchase.push(p2);
        const plan = tragbarkeit({ price: house.amount, grossIncomeYear: gross, hardEquityAvailable: hardAvail, pillar2Available: p2, closingRate });
        if (!plan.pass) {
          houseFailed = true; // keep renting
        } else {
          let need = plan.hardUsed + plan.closingCosts;
          const fromCash = Math.min(need, Math.max(0, cash - buffer));
          cash -= fromCash;
          need -= fromCash;
          const fromParked = Math.min(need, parked);
          parked -= fromParked;
          need -= fromParked;
          const fromPort = Math.min(need, port);
          port -= fromPort;
          need -= fromPort;
          p3a = Math.max(0, p3a - need);
          p2 -= plan.pillar2Used;
          owner = true;
          homeValue = house.amount;
          mortgage = plan.loan;
          mortgageFloor = house.amount * FIRST_MORTGAGE_SHARE;
          amortMonthly = Math.max(0, mortgage - mortgageFloor) / AMORTISATION_YEARS / 12;
          bought++;
          equityIn.push(plan.equity);
          loans.push(plan.loan);
        }
      }
      if (owner) {
        // Interest on the current loan, upkeep on the current value, amortisation down to ⅔ of the price.
        const amort = mortgage > mortgageFloor ? Math.min(amortMonthly, mortgage - mortgageFloor) : 0;
        mortgage -= amort;
        expenses += (mortgage * ACTUAL_MORTGAGE_RATE) / 12 + (homeValue * MAINTENANCE_RATE) / 12 + amort - rentArr[m];
      }
      if (m === retireMonth) spendRet.push(expenses / price);

      // --- savings flow ---
      let surplus = income - expenses;
      if (!retired) {
        p2 += p2Credit[m] * wf;
        if (surplus > 0 && monthlyInvest > 0) {
          const order = Math.min(monthlyInvest, surplus); // pay yourself first: leaves before payday spending
          port += order;
          surplus -= order;
        }
        if (surplus > 0 && leakage > 0) surplus *= 1 - leakage;
        if ((p.contributes3a || optimizing) && surplus > 0) {
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
        const inv = surplus * (optimizing ? 1 : retired ? 0 : p.investShare);
        port += inv;
        cash += surplus - inv;
      } else {
        cash += surplus;
      }

      if (optimizing) {
        const buffer = BUFFER_MONTHS * expenses;
        if (cash > buffer * 1.5) {
          port += cash - buffer;
          cash = buffer;
        }
      }

      // --- shortfall: sell investments; if nothing is left, it's a cash crunch (or savings depleted) ---
      if (cash < 0) {
        let need = -cash;
        const a = Math.min(parked, need);
        parked -= a;
        need -= a;
        const b = Math.min(port, need);
        port -= b;
        need -= b;
        if (need > 0 && p.age + m / 12 >= P3A_EARLIEST_AGE) {
          const c = Math.min(p3a, need);
          p3a -= c;
          need -= c;
        }
        cash = -need;
        if (need > 1) {
          if (!retired) {
            if (m < goalMonth) crunch = true;
          } else if (depletion[path] === Infinity) depletion[path] = p.age + m / 12;
        }
      }

      if (m % 12 === 11) {
        const y = (m + 1) / 12;
        const p2Value = retired ? p2AtRet * Math.max(0, 1 - (m + 1 - retireMonth) / (fullMonths - retireMonth)) : p2;
        nw[row + y] = (cash + port + parked + p3a + p2Value + (owner ? homeValue - mortgage : 0)) / price;
      }
    }

    const goalWorth = nw[row + Math.min(years, goalYear)];
    atGoal[path] = goalWorth;
    if (crunch) crunches++;
    if (!crunch && !houseFailed && goalWorth >= p.goal.target) successes++;
  }

  const thisYear = new Date().getFullYear();
  const bands: YearBand[] = [];
  const col = new Float64Array(paths);
  for (let y = 0; y <= years; y++) {
    for (let i = 0; i < paths; i++) col[i] = nw[i * (years + 1) + y];
    col.sort();
    bands.push({
      year: thisYear + y,
      age: p.age + y,
      p10: col[Math.floor(paths * 0.1)],
      p50: col[Math.floor(paths * 0.5)],
      p90: col[Math.floor(paths * 0.9)],
    });
  }
  atGoal.sort();

  let houseStats: HouseStats | undefined;
  if (house && house.month < months) {
    houseStats = {
      eventId: house.id,
      label: house.label,
      labelMsg: house.labelMsg,
      price: house.amount,
      month: house.month,
      boughtProb: bought / paths,
      medianHardEquity: median(hardAtPurchase),
      medianPillar2: median(p2AtPurchase),
      grossAtPurchase: median(grossAtPurchase),
      closingRate,
      medianEquityAtPurchase: median(equityIn),
      medianLoan: median(loans),
    };
  }

  let retirement: RetirementStats | undefined;
  if (full && retireMonth < months && retireMonth > 0) {
    const dep = Array.from(depletion).sort((a, b) => a - b);
    const p10 = dep[Math.floor(paths * 0.1)];
    const bvg = median(bvgReal);
    const lastGrossMonthly = grossInc[retireMonth - 1] / priceIdx[retireMonth - 1] / 12;
    retirement = {
      age: p.retirementAge,
      lastsTo90Prob: dep.filter((d) => d === Infinity).length / paths,
      depletionAgeP10: Number.isFinite(p10) ? Math.floor(p10) : null,
      replacementRatio: lastGrossMonthly > 0 ? (bvg + ahvToday) / lastGrossMonthly : 0,
      monthlyIncomeAtRetirement: bvg + ahvToday,
      ahvMonthly: ahvToday,
      bvgMonthly: bvg,
      monthlySpending: median(spendRet),
      medianLiquidAtRetirement: median(liquidAtRet),
      bridgeYears: Math.max(0, AHV_AGE - p.retirementAge),
    };
  }

  return {
    bands,
    successProb: successes / paths,
    crunchProb: crunches / paths,
    medianAtGoal: atGoal[Math.floor(paths / 2)] ?? 0,
    goalMonth,
    retirementAge: p.retirementAge,
    ms: now() - t0,
    paths,
    house: houseStats,
    retirement,
  };
}

/** Helpers to move events in time without mutating. */
export function shiftEvent(events: LifeEvent[], id: string, deltaMonths: number): LifeEvent[] {
  return events.map((e) => (e.id === id ? { ...e, month: Math.max(0, e.month + deltaMonths) } : e));
}
