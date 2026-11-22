/**
 * Swiss banking rules, implemented deterministically (no LLM).
 *
 * Tragbarkeit (affordability) follows the standard practice of Swiss lenders:
 *  - at least 20% equity, of which at least 10% must be "hard" equity (not from Pillar 2)
 *  - imputed costs: 5% calculatory interest on the loan + 1% maintenance on the price
 *    + amortisation of the 2nd mortgage (above 2/3 of the price) within 15 years
 *  - imputed costs must not exceed 1/3 of gross household income; payments on other loans (consumer credit,
 *    leasing) count against the same third, as Swiss lenders do
 *  - purchase closing costs (notary, land registry, transfer tax) must be paid from own funds on top
 *
 * The SAME `tragbarkeit()` is used by the affordability card and by the Monte Carlo simulator at the
 * purchase date, so the card and the odds can never disagree.
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
/** Months of expenses kept as a cash buffer — not available as equity (card and simulator alike). */
export const BUFFER_MONTHS = 3;

/** Purchase closing costs as a share of the price (transfer tax + notary + land registry), rough. */
const CLOSING_RATE: Record<string, number> = { GE: 0.03, VD: 0.03, NE: 0.03, FR: 0.03, ZH: 0.015, ZG: 0.01, SZ: 0.01, BE: 0.02 };
export function closingCostRate(canton: string): number {
  return CLOSING_RATE[canton] ?? 0.02;
}

export interface AffordabilityInput {
  price: number;
  grossIncomeYear: number;
  /** Liquid assets above the cash buffer (cash, portfolio, pillar 3a), before closing costs. */
  hardEquityAvailable: number;
  /** Pillar 2 assets that can be withdrawn/pledged (counts towards the first 20% only). */
  pillar2Available: number;
  /** Closing costs as a share of the price, paid from hard equity. Default 0. */
  closingRate?: number;
  /** Yearly payments on other loans (interest + principal), counted in the cost-to-income test. Default 0. */
  otherDebtYear?: number;
}

export interface TragbarkeitPlan {
  pass: boolean;
  /** Hard equity put in (after paying closing costs). */
  hardUsed: number;
  pillar2Used: number;
  equity: number;
  loan: number;
  closingCosts: number;
  yearlyCost: { interest: number; maintenance: number; amortisation: number; total: number };
  costToIncome: number;
  /** Missing equity for the 20% / 10%-hard rules — 0 if fine. */
  equityGap: number;
  /** Additional gross income (CHF/yr) needed at this equity — 0 if fine. */
  incomeGap: number;
  /** Additional hard equity that would make the income rule pass — 0 if fine. */
  extraEquityToPass: number;
  /** Yearly payments on other loans included in `costToIncome` (only present when > 0). */
  otherDebtYear?: number;
}

/** Highest loan whose imputed cost (plus other debt service) stays within ⅓ of gross income, for a given price. */
export function maxLoanForIncome(price: number, grossIncomeYear: number, otherDebtYear = 0): number {
  const budget = grossIncomeYear * MAX_COST_TO_INCOME - price * MAINTENANCE_RATE - otherDebtYear;
  if (budget <= 0) return 0;
  const first = price * FIRST_MORTGAGE_SHARE;
  const onlyFirst = budget / STRESS_RATE;
  if (onlyFirst <= first) return onlyFirst;
  return (budget + first / AMORTISATION_YEARS) / (STRESS_RATE + 1 / AMORTISATION_YEARS);
}

/**
 * The bank test. Puts in the smallest equity that passes (at least 20%, more if the income rule needs a
 * smaller loan). If no amount of available equity passes, reports the best attempt (all eligible equity).
 */
export function tragbarkeit(input: AffordabilityInput): TragbarkeitPlan {
  const { price, grossIncomeYear: gross, pillar2Available } = input;
  const otherDebt = Math.max(0, input.otherDebtYear ?? 0);
  const closingCosts = price * (input.closingRate ?? 0);
  const hard = Math.max(0, input.hardEquityAvailable - closingCosts);
  const minEq = price * MIN_EQUITY;
  const target = Math.min(price, Math.max(minEq, price - maxLoanForIncome(price, gross, otherDebt)));

  const hardUsed = Math.min(hard, target);
  // Pillar 2 may fill the 20% minimum, but not the hard 10% and not the part above 20%.
  const pillar2Used = Math.max(0, Math.min(pillar2Available, minEq - hardUsed));
  const equity = hardUsed + pillar2Used;
  const loan = Math.max(0, price - equity);
  const yearlyCost = imputedCosts(price, loan);
  const costToIncome = gross > 0 ? (yearlyCost.total + otherDebt) / gross : Infinity;
  const equityGap = Math.max(Math.max(0, price * MIN_HARD_EQUITY - hardUsed), Math.max(0, minEq - equity));
  const pass = equityGap === 0 && costToIncome <= MAX_COST_TO_INCOME + 1e-9;
  return {
    pass,
    hardUsed,
    pillar2Used,
    equity,
    loan,
    closingCosts,
    yearlyCost,
    costToIncome,
    equityGap,
    incomeGap: pass ? 0 : Math.max(0, (yearlyCost.total + otherDebt) / MAX_COST_TO_INCOME - gross),
    extraEquityToPass: pass ? 0 : Math.max(0, target - equity),
    ...(otherDebt > 0 ? { otherDebtYear: otherDebt } : {}),
  };
}

export function passesTragbarkeit(input: AffordabilityInput): boolean {
  return tragbarkeit(input).pass;
}

export interface AffordabilityResult extends TragbarkeitPlan {
  price: number;
  equityNeeded: number;
  hardEquityNeeded: number;
  equityUsed: number;
  hardEquityUsed: number;
  /** Highest price that would pass with the same income and equity (at the purchase date). */
  maxPrice: number;
}

export function checkAffordability(input: AffordabilityInput): AffordabilityResult {
  const plan = tragbarkeit(input);
  return {
    ...plan,
    price: input.price,
    equityNeeded: Math.max(input.price * MIN_EQUITY, plan.equity),
    hardEquityNeeded: input.price * MIN_HARD_EQUITY,
    equityUsed: plan.equity,
    hardEquityUsed: plan.hardUsed,
    maxPrice: maxAffordablePrice(input.grossIncomeYear, input.hardEquityAvailable, input.pillar2Available, input.closingRate ?? 0, input.otherDebtYear ?? 0),
  };
}

function imputedCosts(price: number, loan: number) {
  const interest = loan * STRESS_RATE;
  const maintenance = price * MAINTENANCE_RATE;
  const secondMortgage = Math.max(0, loan - price * FIRST_MORTGAGE_SHARE);
  const amortisation = secondMortgage / AMORTISATION_YEARS;
  return { interest, maintenance, amortisation, total: interest + maintenance + amortisation };
}

/** Binary search for the highest price that passes the bank test (same rule as `tragbarkeit`). */
export function maxAffordablePrice(gross: number, hard: number, p2: number, closingRate = 0, otherDebtYear = 0): number {
  let lo = 0;
  let hi = 20_000_000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (passesTragbarkeit({ price: mid, grossIncomeYear: gross, hardEquityAvailable: hard, pillar2Available: p2, closingRate, otherDebtYear })) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo / 1000) * 1000;
}

/** Actual monthly cost of owning at the purchase date (the simulator recomputes it monthly). */
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
