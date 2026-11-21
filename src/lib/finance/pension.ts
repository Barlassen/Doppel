/**
 * Swiss 1st & 2nd pillar + tax approximations, deterministic and documented (no LLM).
 * Figures: AHV/BVG parameters 2025/26. These are deliberately simple approximations for a planning twin,
 * not a pension-fund statement.
 */

/** Maximum single AHV old-age pension, CHF/month (2025/26). */
export const AHV_MAX_MONTHLY = 2520;
/** 13th AHV pension (paid from December 2026) → 13 payments a year. */
export const AHV_13TH_FACTOR = 13 / 12;
export const AHV_AGE = 65;
/** Average yearly income that earns the maximum pension (2025/26). */
export const AHV_FULL_INCOME = 90_720;
export const AHV_MIN_INCOME = 15_120;
/** Assumption: a few missing contribution years (studies/abroad) → 90% of the scale pension. */
export const AHV_GAP_FACTOR = 0.9;

/** BVG coordination deduction (2025/26). Coordinated salary = gross − deduction (enveloping plan, no upper cap). */
export const BVG_COORDINATION_DEDUCTION = 26_460;
export const BVG_MIN_COORDINATED = 3_780;
/** Blended conversion rate of an enveloping pension fund at 65 (legal minimum 6.8% only on the mandatory part). */
export const BVG_CONVERSION_AT_65 = 0.055;
/** Conversion rate change per year of earlier/later retirement. */
export const BVG_CONVERSION_STEP = 0.0015;

/** Employee social deductions on a Swiss payslip: AHV/IV/EO 5.3% + ALV 1.1% + BVG ~5.5% + NBU ~1%. */
export const SOCIAL_DEDUCTIONS = 0.13;
/** Effective income tax ≈ half of the marginal rate (progressive Swiss tax, rough). */
export const EFFECTIVE_TAX_SHARE = 0.5;
/** Retirement income is taxed in a lower bracket. */
export const RETIREMENT_TAX_FACTOR = 0.75;
/** Pillar 3a capital-withdrawal tax (separate, reduced rate). */
export const P3A_PAYOUT_TAX = 0.06;
/** Earliest age for an ordinary pillar 3a withdrawal (5 years before AHV age). */
export const P3A_EARLIEST_AGE = 60;
/** Assumed number of salaries per year when reading a payslip (13th month salary is the Swiss norm). */
export const PAYSLIP_SALARIES = 13;

/** BVG age credits (savings contributions, employer + employee) on the coordinated salary. */
export function bvgAgeCredit(age: number): number {
  if (age < 25) return 0;
  if (age < 35) return 0.07;
  if (age < 45) return 0.1;
  if (age < 55) return 0.15;
  return 0.18;
}

export function coordinatedSalary(grossYear: number): number {
  if (grossYear < 22_680) return 0; // below the BVG entry threshold
  return Math.max(BVG_MIN_COORDINATED, grossYear - BVG_COORDINATION_DEDUCTION);
}

export function bvgConversionRate(retirementAge: number): number {
  const r = BVG_CONVERSION_AT_65 - BVG_CONVERSION_STEP * (65 - retirementAge);
  return Math.min(0.0625, Math.max(0.04, r));
}

/** AHV old-age pension in today's CHF per month (incl. the 13th pension, spread over 12 months). */
export function ahvMonthly(grossYear: number): number {
  const scale = Math.min(1, Math.max(0.5, 0.5 + (0.5 * (grossYear - AHV_MIN_INCOME)) / (AHV_FULL_INCOME - AHV_MIN_INCOME)));
  return AHV_MAX_MONTHLY * AHV_13TH_FACTOR * AHV_GAP_FACTOR * scale;
}

export function effectiveTaxRate(marginalTaxRate: number): number {
  return Math.min(0.45, Math.max(0, marginalTaxRate * EFFECTIVE_TAX_SHARE));
}

/**
 * A Swiss payslip shows *Nettolohn*: gross minus social deductions, but **before income tax**, paid 12 or 13×.
 * Approximation (documented):
 *  - gross ≈ Nettolohn / (1 − 13% social deductions) × 13 salaries
 *  - with a calibrated current income (`current`): take-home changes by the change in pre-tax pay taxed at the
 *    MARGINAL rate — so a payslip that matches the profile changes nothing, and a raise is taxed at the margin;
 *  - without one: take-home = Nettolohn × 13 × (1 − effective tax) / 12, effective tax ≈ ½ × marginal rate.
 */
export function payslipToIncome(
  netBeforeTaxMonth: number,
  marginalTaxRate: number,
  current?: { grossIncomeYear: number; netIncomeMonth: number },
  salaries = PAYSLIP_SALARIES,
): { grossIncomeYear: number; netIncomeMonth: number } {
  const preTaxYear = netBeforeTaxMonth * salaries;
  const grossIncomeYear = Math.round(preTaxYear / (1 - SOCIAL_DEDUCTIONS) / 100) * 100;
  let takeHomeYear: number;
  if (current && current.grossIncomeYear > 0 && current.netIncomeMonth > 0) {
    const currentPreTax = current.grossIncomeYear * (1 - SOCIAL_DEDUCTIONS);
    takeHomeYear = current.netIncomeMonth * 12 + (preTaxYear - currentPreTax) * (1 - marginalTaxRate);
  } else {
    takeHomeYear = preTaxYear * (1 - effectiveTaxRate(marginalTaxRate));
  }
  return { grossIncomeYear, netIncomeMonth: Math.round(takeHomeYear / 12 / 10) * 10 };
}
