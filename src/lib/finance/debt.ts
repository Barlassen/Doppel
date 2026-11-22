/**
 * Loans on the balance sheet: annuity amortisation, deterministic and shared by the simulator, the debt card, the
 * solver's "pay down debt" lever and `scripts/ubs-check.ts`.
 *
 * Model (monthly, nominal CHF):
 *  - interest_m  = balance_{m−1} × annualRate / 12
 *  - payment_m   = min(monthlyPayment, balance_{m−1} + interest_m)      (the last payment is smaller)
 *  - principal_m = payment_m − interest_m;  balance_m = balance_{m−1} − principal_m
 *  - an extra monthly amount goes to the loan with the highest rate first ("avalanche"), never above its balance
 *  - payments are always made: they are cash outflows like rent, and a shortfall is a cash crunch
 * Without a payment in the data, the annuity over `DEFAULT_LOAN_TERM_MONTHS` is used:
 *    payment = P × r / (1 − (1 + r)^−n),  r = annualRate / 12  (P / n when r = 0)
 * A `mortgage` liability without a payment is interest-only (balance constant).
 */
import type { Liability, Profile } from "./types";

/**
 * Remaining term assumed when a loan has no payment in the data (Doppel default, not UBS data). Swiss consumer
 * loans typically run 12–84 months; 60 months sits in the middle.
 */
export const DEFAULT_LOAN_TERM_MONTHS = 60;

/** Fixed monthly annuity that repays `principal` in `termMonths` at `annualRate`. */
export function annuityPayment(principal: number, annualRate: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}

/** Total outstanding debt (month 0). */
export function totalDebt(p: Pick<Profile, "liabilities">): number {
  return (p.liabilities ?? []).reduce((s, l) => s + Math.max(0, l.principal), 0);
}

/**
 * Doppel net worth today: cash + portfolio + pillar 2 + pillar 3a − liabilities. The simulator adds home equity
 * once a home is bought.
 */
export function netWorthOf(p: Pick<Profile, "cash" | "portfolio" | "pillar2" | "pillar3a" | "liabilities">): number {
  const assets = p.cash + p.portfolio + p.pillar2 + p.pillar3a;
  return p.liabilities?.length ? assets - totalDebt(p) : assets;
}

export interface DebtSchedule {
  months: number;
  /** Cash paid in month m (contractual + extra). */
  payment: Float64Array;
  interest: Float64Array;
  principal: Float64Array;
  /** Total balance after month m's payment. */
  balance: Float64Array;
  /** Contractual payments due in month m on loans outstanding at its start (what a bank counts). */
  service: Float64Array;
  /** Per loan: balance after each month (same order as the input). */
  perLoan: Float64Array[];
  opening: number;
  /** First month after which every balance is 0 (1-based count of months), null if not within `months`. */
  debtFreeMonth: number | null;
  interestPaid: number;
}

/** Month-by-month schedule of all loans with an optional extra payment. Pure and deterministic. */
export function debtSchedule(liabilities: readonly Liability[], months: number, extraMonthly = 0): DebtSchedule {
  const n = liabilities.length;
  const bal = liabilities.map((l) => Math.max(0, l.principal));
  const rate = liabilities.map((l) => l.annualRate / 12);
  // Avalanche order for extra payments: highest rate first, then the list order.
  const order = liabilities.map((_, i) => i).sort((a, b) => liabilities[b].annualRate - liabilities[a].annualRate || a - b);
  const s: DebtSchedule = {
    months,
    payment: new Float64Array(months),
    interest: new Float64Array(months),
    principal: new Float64Array(months),
    balance: new Float64Array(months),
    service: new Float64Array(months),
    perLoan: liabilities.map(() => new Float64Array(months)),
    opening: bal.reduce((x, y) => x + y, 0),
    debtFreeMonth: null,
    interestPaid: 0,
  };
  if (s.opening === 0) s.debtFreeMonth = 0;
  const extra = Math.max(0, extraMonthly);
  for (let m = 0; m < months; m++) {
    let pay = 0;
    let int = 0;
    let prin = 0;
    let service = 0;
    for (let i = 0; i < n; i++) {
      if (bal[i] <= 0) continue;
      const l = liabilities[i];
      const interest = bal[i] * rate[i];
      // Interest-only mortgage when the data gives no payment.
      const due = l.monthlyPayment > 0 ? l.monthlyPayment : l.kind === "mortgage" ? interest : 0;
      service += due;
      const p = Math.min(due, bal[i] + interest);
      bal[i] = bal[i] + interest - p;
      if (bal[i] < 1e-6) bal[i] = 0;
      pay += p;
      int += interest;
      prin += p - interest;
    }
    let left = extra;
    for (const i of order) {
      if (left <= 0) break;
      if (bal[i] <= 0) continue;
      const x = Math.min(left, bal[i]);
      bal[i] -= x;
      if (bal[i] < 1e-6) bal[i] = 0;
      left -= x;
      pay += x;
      prin += x;
    }
    let total = 0;
    for (let i = 0; i < n; i++) {
      s.perLoan[i][m] = bal[i];
      total += bal[i];
    }
    s.payment[m] = pay;
    s.interest[m] = int;
    s.principal[m] = prin;
    s.balance[m] = total;
    s.service[m] = service;
    s.interestPaid += int;
    if (s.debtFreeMonth === null && total === 0) s.debtFreeMonth = m + 1;
  }
  return s;
}
