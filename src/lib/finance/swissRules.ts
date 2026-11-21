/**
 * Swiss banking rules, implemented deterministically (no LLM).
 *
 * Tragbarkeit (affordability) follows the standard practice of Swiss lenders:
 *  - at least 20% equity, of which at least 10% must be "hard" equity (not from Pillar 2)
 *  - imputed costs: 5% calculatory interest on the loan + 1% maintenance on the price
 *    + amortisation of the 2nd mortgage (above 2/3 of the price) within 15 years
 *  - imputed costs must not exceed 1/3 of gross household income
 */

export const STRESS_RATE = 0.05;
export const MAINTENANCE_RATE = 0.01;
export const MAX_COST_TO_INCOME = 1 / 3;
export const MIN_EQUITY = 0.2;
export const MIN_HARD_EQUITY = 0.1;
export const FIRST_MORTGAGE_SHARE = 2 / 3;
export const AMORTISATION_YEARS = 15;
/** Pillar 3a maximum for employees affiliated with a pension fund (CHF). */
export const PILLAR_3A_MAX = 7258;
/** Realistic current mortgage rate used for the actual cash-flow (not the stress test). */
export const ACTUAL_MORTGAGE_RATE = 0.018;

export interface AffordabilityInput {
  price: number;
  grossIncomeYear: number;
  /** Liquid assets that can count as hard equity (cash, portfolio, pillar 3a). */
  hardEquityAvailable: number;
  /** Pillar 2 assets that can be withdrawn/pledged. */
  pillar2Available: number;
}

export interface AffordabilityResult {
  pass: boolean;
  price: number;
  equityNeeded: number;
  hardEquityNeeded: number;
  equityUsed: number;
  hardEquityUsed: number;
  pillar2Used: number;
  loan: number;
  yearlyCost: { interest: number; maintenance: number; amortisation: number; total: number };
  costToIncome: number;
  /** Missing equity (CHF) — 0 if fine. */
  equityGap: number;
  /** Additional gross income (CHF/yr) needed — 0 if fine. */
  incomeGap: number;
  /** Highest price that would pass with today's income and equity. */
  maxPrice: number;
}

export function checkAffordability(input: AffordabilityInput): AffordabilityResult {
  const { price, grossIncomeYear, hardEquityAvailable, pillar2Available } = input;
  const equityNeeded = price * MIN_EQUITY;
  const hardEquityNeeded = price * MIN_HARD_EQUITY;

  // Banks let you put in more than 20% — every extra franc of equity lowers the loan.
  const hardEquityUsed = Math.min(hardEquityAvailable, price);
  const pillar2Used = Math.min(pillar2Available, Math.max(0, equityNeeded - hardEquityUsed));
  const equityUsed = hardEquityUsed + pillar2Used;

  const hardGap = Math.max(0, hardEquityNeeded - hardEquityUsed);
  const totalGap = Math.max(0, equityNeeded - equityUsed);
  const equityGap = Math.max(hardGap, totalGap);

  const loan = Math.max(0, price - equityUsed);
  const yearlyCost = costs(price, loan);
  const costToIncome = grossIncomeYear > 0 ? yearlyCost.total / grossIncomeYear : Infinity;
  const incomeGap = Math.max(0, yearlyCost.total / MAX_COST_TO_INCOME - grossIncomeYear);

  return {
    pass: equityGap === 0 && costToIncome <= MAX_COST_TO_INCOME + 1e-9,
    price,
    equityNeeded,
    hardEquityNeeded,
    equityUsed,
    hardEquityUsed,
    pillar2Used,
    loan,
    yearlyCost,
    costToIncome,
    equityGap,
    incomeGap,
    maxPrice: maxAffordablePrice(grossIncomeYear, hardEquityAvailable, pillar2Available),
  };
}

function costs(price: number, loan: number) {
  const interest = loan * STRESS_RATE;
  const maintenance = price * MAINTENANCE_RATE;
  const secondMortgage = Math.max(0, loan - price * FIRST_MORTGAGE_SHARE);
  const amortisation = secondMortgage / AMORTISATION_YEARS;
  return { interest, maintenance, amortisation, total: interest + maintenance + amortisation };
}

/** Binary search for the highest price that passes both the equity and the income rule. */
export function maxAffordablePrice(gross: number, hard: number, p2: number): number {
  let lo = 0;
  let hi = 10_000_000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = quickPass(mid, gross, hard, p2);
    if (r) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo / 1000) * 1000;
}

function quickPass(price: number, gross: number, hard: number, p2: number) {
  const eqNeed = price * MIN_EQUITY;
  const hardUsed = Math.min(hard, price);
  if (hardUsed < price * MIN_HARD_EQUITY) return false;
  const eqUsed = hardUsed + Math.min(p2, Math.max(0, eqNeed - hardUsed));
  if (eqUsed < eqNeed) return false;
  return costs(price, price - eqUsed).total <= gross * MAX_COST_TO_INCOME;
}

/** Actual monthly cost of owning (used in the cash-flow simulation, not the stress test). */
export function ownershipMonthlyCost(price: number, loan: number): number {
  const interest = loan * ACTUAL_MORTGAGE_RATE;
  const maintenance = price * MAINTENANCE_RATE;
  const secondMortgage = Math.max(0, loan - price * FIRST_MORTGAGE_SHARE);
  return (interest + maintenance + secondMortgage / AMORTISATION_YEARS) / 12;
}

/** Yearly tax saving from a Pillar 3a contribution. */
export function pillar3aTaxSaving(contribution: number, marginalTaxRate: number): number {
  return Math.min(contribution, PILLAR_3A_MAX) * marginalTaxRate;
}

/**
 * Hard equity a person will have in `months`, assuming they keep saving ~90% of today's
 * surplus and keep a 3-month cash buffer. Deterministic and intentionally simple.
 */
export function projectedHardEquity(
  p: { cash: number; portfolio: number; pillar3a: number; netIncomeMonth: number; expensesMonth: number },
  months: number,
): number {
  const surplus = Math.max(0, p.netIncomeMonth - p.expensesMonth);
  return Math.max(0, p.cash - 3 * p.expensesMonth) + p.portfolio + p.pillar3a + months * surplus * 0.9;
}

export function projectedGross(gross: number, months: number): number {
  return gross * Math.pow(1.012, months / 12);
}
