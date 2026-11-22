import { mulberry32, normalSampler } from "@/lib/finance/rng";
import {
  ACTUAL_MORTGAGE_RATE,
  AMORTISATION_YEARS,
  BUFFER_MONTHS,
  FIRST_MORTGAGE_SHARE,
  MAINTENANCE_RATE,
  PILLAR_3A_MAX,
  closingCostRate,
  tragbarkeit,
} from "@/lib/finance/swissRules";
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
} from "@/lib/finance/pension";
import { debtSchedule } from "@/lib/finance/debt";
import { defaultHealthPremium, premiumDrift } from "@/lib/finance/canton";
import { ASSUMPTIONS as DASHBOARD_ASSUMPTIONS, EQUITY_WEIGHT as DASHBOARD_EQUITY_WEIGHT } from "@/lib/finance/monteCarlo";
import type { GoalMetric, GoalStats, HouseStats, LifeEvent, RetirementStats, RiskProfile, SimInput as BaseSimInput, SimResult, YearBand } from "@/lib/finance/types";

/*
 * Doppel Play's simulator: the dashboard's simulator (`src/lib/finance/monteCarlo.ts`) plus the game's extensions.
 *
 * It is a copy, re-forked on 2026-11-22 from the dashboard's current code, and it must stay one: with none of the
 * extensions below in the input, `simulate` here returns exactly what the dashboard's `simulate` returns (bands,
 * odds, retirement, home, goals and debt statistics). `npm run play:check` compares the two on the built-in accounts
 * and on UBS profiles with loans, without a pension fund, and in retirement, so a change to the dashboard engine that
 * is not mirrored here fails the check instead of drifting silently. The capital-market assumptions are the
 * dashboard's own object (imported, not copied).
 *
 * The extensions (all optional; the game passes them through `toSimInput` in state.ts):
 *  - `assumptions`: an economic regime;
 *  - `incomePhases`: the game's phases (study, leave, part-time, abroad). Unlike the dashboard's `phases` they are
 *    indexed with wages and prices and end for good, because the game's year stepper (`stepYear`) carries them
 *    from year to year that way;
 *  - `home`, `debts`: a home and amortising loans that already exist at the start;
 *  - `shocks`: random job losses and crashes on their own random stream;
 *  - `conventions`: three bookkeeping rules of the game's stepper that differ from the dashboard on purpose.
 */

export interface IncomePhase {
  startMonth: number;
  endMonth: number;
  netIncomeMonth: number;
  grossIncomeYear: number;
  /** Total monthly spending incl. rent during the phase. */
  expensesMonth: number;
  /** false = no Swiss pillar 2 credits during the phase (abroad, self-employed). */
  bvg?: boolean;
}

/** Bookkeeping rules of the game's year stepper (state.ts). Absent = the dashboard's rules. */
export interface PlayConventions {
  /** Health premiums step up once a year, at the turn of the game year, instead of every month. */
  premiumYearly?: boolean;
  /** A pension fund that became an annuity is income, not capital: it no longer counts in net worth. */
  annuityNotCapital?: boolean;
  /** Savings that run out in retirement before the goal date count as a cash crunch, as they do while working. */
  crunchWhenRetired?: boolean;
}

/** The dashboard's input plus Doppel Play's optional extensions. Absent → exactly the dashboard's engine. */
export type SimInput = BaseSimInput & {
  /** Capital-market and household assumptions overriding `ASSUMPTIONS` (an economic regime). */
  assumptions?: Partial<SimAssumptions>;
  /** The game's phases overriding the profile in [startMonth, endMonth). Today's CHF, indexed. */
  incomePhases?: IncomePhase[];
  /** Start as a homeowner (value and mortgage in today's CHF). The profile's rent should then be 0. */
  home?: { value: number; mortgage: number; floor?: number; rate?: number };
  /** Amortising loans: interest accrues monthly, payments from `startMonth`. Outstanding principal counts against net worth. */
  debts?: { principal: number; rate: number; monthlyPayment: number; startMonth?: number }[];
  /** Random regime shocks on a separate stream: a job loss or a market crash in a given year. */
  shocks?: { jobLossProbYear: number; jobLossMonths: number; crashProbYear: number };
  conventions?: PlayConventions;
};

export type SimAssumptions = typeof DASHBOARD_ASSUMPTIONS;

/** Yearly nominal capital-market and household assumptions: the dashboard's (one object, not a copy). */
export const ASSUMPTIONS: SimAssumptions = DASHBOARD_ASSUMPTIONS;

/**
 * Accounting mode (`SimInput.accounting`): no returns, rates, inflation or wage growth, so the simulated cash must
 * equal the plain ledger (same as the dashboard's).
 */
const ACCOUNTING: SimAssumptions = {
  ...ASSUMPTIONS,
  equity: { mu: 0, sigma: 0 },
  bonds: { mu: 0, sigma: 0 },
  cashRate: 0,
  overdraftRate: 0,
  inflation: 0,
  wageGrowth: 0,
  home: { mu: 0, sigma: 0 },
  wageVol: 0,
  pillar2Rate: 0,
  crashShock: 0,
  healthExcessGrowth: 0,
};

export const EQUITY_WEIGHT: Record<RiskProfile, number> = DASHBOARD_EQUITY_WEIGHT;
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
  const acc = !!input.accounting;
  // Optional overrides (Doppel Play regimes). Without them every line below runs exactly as the dashboard's.
  const A: SimAssumptions = acc ? ACCOUNTING : input.assumptions ? { ...ASSUMPTIONS, ...input.assumptions } : ASSUMPTIONS;
  const incomePhases = input.incomePhases?.length ? input.incomePhases : null;
  const startHome = input.home;
  const mortgageRate = startHome?.rate ?? ACTUAL_MORTGAGE_RATE;
  const loans0 = input.debts ?? [];
  const shocks = input.shocks;
  const conv = input.conventions ?? {};

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
  const premium = p.healthPremiumMonth ?? defaultHealthPremium(p);
  // Already retired at the start: today's spending already is retirement spending.
  const retSpending = p.retirementAge <= p.age ? 1 : A.retirementSpending;
  const bvgInsured = p.bvgInsured !== false;
  const phases = input.phases?.length ? [...input.phases].sort((a, b) => a.startMonth - b.startMonth) : null;
  const lastPhase = phases ? phases.reduce((a, b) => (b.endMonth > a.endMonth ? b : a)) : null;

  // Loans: payments are fixed, so the schedule is the same in every future (computed once).
  const debtLoans = p.liabilities?.filter((l) => l.principal > 0) ?? [];
  const debt = debtLoans.length ? debtSchedule(debtLoans, months, input.extraDebtPayment ?? 0) : null;

  // ---------- path-independent monthly schedule (salary, spending, events) ----------
  const priceIdx = new Float64Array(months);
  const netIncome = new Float64Array(months);
  const grossInc = new Float64Array(months);
  const p2Credit = new Float64Array(months);
  const baseExp = new Float64Array(months);
  const rentArr = new Float64Array(months);
  const oneOff = new Float64Array(months);
  const crash = new Uint8Array(months);
  /** 1 = income given by a phase (not scaled by career luck). */
  const fixedIncome = new Uint8Array(months);
  {
    let wage = 1;
    let price = 1;
    const mWage = Math.pow(1 + A.wageGrowth, 1 / 12);
    const mInfl = Math.pow(1 + A.inflation, 1 / 12);
    let wageEnd = 1;
    let priceEnd = 1;
    for (let m = 0; m < months; m++) {
      wage *= mWage;
      price *= mInfl;
      priceIdx[m] = price;
      const retired = m >= retireMonth;
      let gross = p.grossIncomeYear * wage;
      let net = p.netIncomeMonth * wage;
      let living = baseMonthly;
      let livingIdx = price;
      let wageIdx = wage;
      let insured = bvgInsured;
      if (phases && lastPhase) {
        const ph = phases.find((x) => m >= x.startMonth && m < x.endMonth);
        if (m === lastPhase.endMonth) {
          wageEnd = wage / mWage;
          priceEnd = price / mInfl;
        }
        if (ph) {
          // As given: nominal, not indexed, not scaled by career luck.
          gross = ph.grossIncomeYear;
          net = ph.netIncomeMonth;
          living = Math.max(0, ph.expensesMonth + (input.expenseDelta ?? 0));
          livingIdx = 1;
          wageIdx = 1;
          insured = bvgInsured && ph.bvgInsured !== false;
          fixedIncome[m] = 1;
        } else if (m >= lastPhase.endMonth) {
          // After the last phase it continues, indexed from its end.
          gross = lastPhase.grossIncomeYear * (wage / wageEnd);
          net = lastPhase.netIncomeMonth * (wage / wageEnd);
          living = Math.max(0, lastPhase.expensesMonth + (input.expenseDelta ?? 0));
          livingIdx = price / priceEnd;
          wageIdx = wage / wageEnd;
          insured = bvgInsured && lastPhase.bvgInsured !== false;
        }
      }
      // The game's phases: today's CHF, indexed with wages and prices, never below the rent (as in `stepYear`).
      const gp = incomePhases ? incomePhases.find((x) => m >= x.startMonth && m < x.endMonth) : undefined;
      if (gp) {
        gross = gp.grossIncomeYear * wage;
        net = gp.netIncomeMonth * wage;
        living = Math.max(p.rentMonth, gp.expensesMonth + (input.expenseDelta ?? 0));
        insured = insured && gp.bvg !== false;
      }
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
      p2Credit[m] = retired || unemployed || !insured ? 0 : (bvgAgeCredit(ageNow) * coordinatedSalary(gross / wageIdx) * wageIdx) / 12;
      const spend = retired ? (living - p.rentMonth) * retSpending + p.rentMonth : living;
      // Health premiums grow faster than prices: the part above inflation is added on top (canton.ts).
      // The game's stepper raises them once a year instead (conventions.premiumYearly).
      baseExp[m] = spend * livingIdx + child + premiumDrift(premium, conv.premiumYearly ? m : m + 1, price, !!conv.premiumYearly, A.healthExcessGrowth);
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
  const otherDebtAtPurchase: number[] = [];
  // Goals: the headline metric, and every listed goal inside the horizon.
  const metric: GoalMetric = p.goal.metric ?? "netWorth";
  const listed = (p.goals ?? []).map((g) => ({ g, year: Math.max(0, g.age - p.age) })).filter((x) => x.year <= years);
  const goalVals = listed.map(() => new Float64Array(paths));
  const goalHits = listed.map(() => 0);
  const trace = input.trace ? { cash: [] as number[], debt: [] as number[] } : undefined;

  for (let path = 0; path < paths; path++) {
    const ps = pathSeed(seed, path);
    const randn = normalSampler(mulberry32(ps));
    // Separate stream for behavioural coin-flips so "ideal" and "real" twins see the same markets.
    const brand = mulberry32(ps ^ 0x5bd1e995);
    // Optional regime shocks (Doppel Play): their own stream, so markets stay aligned across sibling moves.
    const srand = shocks ? mulberry32(ps ^ 0x27d4eb2f) : null;
    let shockCrashMonth = -1;
    let shockJoblessUntil = -1;
    const loanBal = loans0.map((d) => d.principal);

    let cash = p.cash;
    let port = p.portfolio;
    let parked = 0; // panic-sold money waiting in cash
    let p3a = p.pillar3a;
    let p2 = p.pillar2;
    let homeValue = startHome ? startHome.value : 0;
    let mortgage = startHome ? startHome.mortgage : 0;
    let mortgageFloor = startHome ? (startHome.floor ?? startHome.value * FIRST_MORTGAGE_SHARE) : 0;
    let amortMonthly = startHome ? Math.max(0, mortgage - mortgageFloor) / AMORTISATION_YEARS / 12 : 0;
    let owner = !!startHome;
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
    let crunchMonth = Infinity;

    const row = path * (years + 1);
    nw[row] = (debt ? cash + port + p3a + p2 - debt.opening : cash + port + p3a + p2) + (owner ? homeValue - mortgage : 0) - loanBal.reduce((a, b) => a + b, 0);
    /** A goal metric now, in today's CHF (`nwNow` = net worth just computed for this year end). */
    const valueOf = (k: GoalMetric, nwNow: number, priceNow: number) =>
      k === "netWorth"
        ? nwNow
        : k === "cash"
          ? (cash + parked) / priceNow
          : k === "liquid"
            ? (cash + parked + port) / priceNow
            : (cash + parked + port + p3a) / priceNow;
    let goalWorth = goalYear === 0 ? valueOf(metric, nw[row], 1) : 0;
    for (let g = 0; g < listed.length; g++) if (listed[g].year === 0) goalVals[g][path] = valueOf(listed[g].g.metric ?? "netWorth", nw[row], 1);

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

      if (srand && shocks && m % 12 === 0) {
        if (srand() < shocks.crashProbYear) shockCrashMonth = m + Math.floor(srand() * 12);
        if (m >= shockJoblessUntil && srand() < shocks.jobLossProbYear) shockJoblessUntil = m + Math.floor(srand() * 12) + shocks.jobLossMonths;
      }
      const shockJobless = shockJoblessUntil > m && shockJoblessUntil - (shocks?.jobLossMonths ?? 0) <= m;

      // --- markets (same draws for every scenario on this path; none in accounting mode) ---
      const rE = acc ? 0 : crash[m] || m === shockCrashMonth ? A.crashShock : eMu + eSd * randn();
      const rB = acc ? 0 : bMu + bSd * randn();
      const rH = acc ? 0 : hMu + hSd * randn();
      if (m % 12 === 0 && !acc) {
        const z = randn();
        if (m > 0) wf *= Math.exp(A.wageVol * z + wageDrift);
      }
      const luck = fixedIncome[m] ? 1 : wf;
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
      const income = retired
        ? (bvgMonthly + (m >= ahvMonth ? ahvToday * price : 0)) * (1 - retTax)
        : netIncome[m] * luck * (shockJobless ? A.unemploymentReplacement : 1);
      let expenses = baseExp[m];
      if (debt) expenses += debt.payment[m];
      let loanPay = 0;
      for (let d = 0; d < loanBal.length; d++) {
        if (loanBal[d] <= 0) continue;
        const spec = loans0[d];
        loanBal[d] += (loanBal[d] * spec.rate) / 12;
        if (m >= (spec.startMonth ?? 0)) {
          const pay = Math.min(spec.monthlyPayment, loanBal[d]);
          loanBal[d] -= pay;
          loanPay += pay;
        }
      }
      expenses += loanPay;
      cash += oneOff[m];

      // --- home purchase: the bank test runs at the purchase date with this future's equity & salary ---
      if (house && m === house.month) {
        const buffer = BUFFER_MONTHS * expenses;
        const hardAvail = Math.max(0, cash - buffer) + parked + port + p3a;
        const gross = retired ? (bvgMonthly + (m >= ahvMonth ? ahvToday * price : 0)) * 12 : grossInc[m] * luck;
        hardAtPurchase.push(hardAvail);
        grossAtPurchase.push(gross);
        p2AtPurchase.push(p2);
        // Banks count the payments on other loans against the same third of income.
        const otherDebtYear = (debt ? debt.service[m] * 12 : 0) + loanPay * 12;
        if (debt) otherDebtAtPurchase.push(otherDebtYear);
        const plan = tragbarkeit({
          price: house.amount,
          grossIncomeYear: gross,
          hardEquityAvailable: hardAvail,
          pillar2Available: p2,
          closingRate,
          ...(debt || loanBal.length ? { otherDebtYear } : {}),
        });
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
        expenses += (mortgage * mortgageRate) / 12 + (homeValue * MAINTENANCE_RATE) / 12 + amort - rentArr[m];
      }
      if (m === retireMonth) spendRet.push(expenses / price);

      // --- savings flow ---
      let surplus = income - expenses;
      if (!retired) {
        if (!shockJobless) p2 += p2Credit[m] * luck;
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
            if (crunchMonth === Infinity) crunchMonth = m;
          } else {
            if (depletion[path] === Infinity) depletion[path] = p.age + m / 12;
            if (conv.crunchWhenRetired && m < goalMonth) crunch = true;
          }
        }
      }
      if (trace && path === 0) {
        trace.cash.push(cash);
        trace.debt.push(debt ? debt.balance[m] : 0);
      }

      if (m % 12 === 11) {
        const y = (m + 1) / 12;
        // The dashboard counts the annuity's remaining capital; the game's positions do not (conventions.annuityNotCapital).
        const p2Value = retired ? (conv.annuityNotCapital ? 0 : p2AtRet * Math.max(0, 1 - (m + 1 - retireMonth) / (fullMonths - retireMonth))) : p2;
        const assets = cash + port + parked + p3a + p2Value + (owner ? homeValue - mortgage : 0);
        let owed = 0;
        for (let d = 0; d < loanBal.length; d++) owed += loanBal[d];
        nw[row + y] = ((debt ? assets - debt.balance[m] : assets) - owed) / price;
        if (y === Math.min(years, goalYear)) goalWorth = valueOf(metric, nw[row + y], price);
        for (let g = 0; g < listed.length; g++) if (listed[g].year === y) goalVals[g][path] = valueOf(listed[g].g.metric ?? "netWorth", nw[row + y], price);
      }
    }

    atGoal[path] = goalWorth;
    if (crunch) crunches++;
    if (!crunch && !houseFailed && goalWorth >= p.goal.target) successes++;
    // Every listed goal, same rule as the headline: no crunch before its date, no failed home purchase, target met.
    for (let g = 0; g < listed.length; g++) {
      if (crunchMonth >= listed[g].year * 12 && !houseFailed && goalVals[g][path] >= listed[g].g.target) goalHits[g]++;
    }
  }

  // Calendar year of month 0: the profile's as-of date (a dataset snapshot), else today.
  const thisYear = p.asOf ? Number(p.asOf.slice(0, 4)) : new Date().getFullYear();
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
      ...(debt ? { medianOtherDebtYear: median(otherDebtAtPurchase) } : {}),
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
    ...(p.goals
      ? {
          goals: listed.map(
            ({ g, year }, i): GoalStats => ({ id: g.id, prob: goalHits[i] / paths, median: median(Array.from(goalVals[i])), month: year * 12 }),
          ),
        }
      : {}),
    ...(debt
      ? { debt: { start: debt.opening, monthlyService: debt.service[0] ?? 0, debtFreeMonth: debt.debtFreeMonth, interestPaid: debt.interestPaid } }
      : {}),
    ...(trace ? { trace } : {}),
  };
}

/** Helpers to move events in time without mutating. */
export function shiftEvent(events: LifeEvent[], id: string, deltaMonths: number): LifeEvent[] {
  return events.map((e) => (e.id === id ? { ...e, month: Math.max(0, e.month + deltaMonths) } : e));
}
