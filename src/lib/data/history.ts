import { mulberry32 } from "@/lib/finance/rng";
import { MARKET_INDEX } from "@/lib/finance/investBehavior";
import type { InvestmentTrade, Transaction } from "@/lib/finance/types";

type Category = Transaction["category"];

/** A cost that is booked every month on the same day (rent, insurance, subscriptions…). */
export interface FixedItem {
  day: number;
  merchant: string;
  category: Category;
  amount: number;
}

/** A habit: about `perMonth` purchases a month at one of `merchants`, CHF `min`–`max` each. */
export interface VariableItem {
  merchants: readonly string[];
  category: Category;
  perMonth: number;
  min: number;
  max: number;
  /** Relative weight of the payday window (day 25 to day 2) when picking the day. 1 = no spike. */
  payday?: number;
}

export interface SpendPlan {
  seed: number;
  /** "yyyy-mm" months of history. */
  months: readonly string[];
  fixed: readonly FixedItem[];
  variable: readonly VariableItem[];
  oneOff?: readonly Transaction[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const round05 = (x: number) => Math.round(x * 20) / 20;
const isPayday = (day: number) => day >= 25 || day <= 2;

/**
 * Seeded, deterministic transaction history (same plan → same transactions on server and client).
 * Output has the plain `Transaction` shape the bank-statement importers will produce later.
 */
export function generateTransactions(plan: SpendPlan): Transaction[] {
  const r = mulberry32(plan.seed);
  const tx: Transaction[] = [];
  for (const month of plan.months) {
    const days = daysIn(month);
    for (const f of plan.fixed) tx.push({ date: `${month}-${pad(Math.min(f.day, days))}`, merchant: f.merchant, category: f.category, amount: f.amount });
    for (const v of plan.variable) {
      const weights = Array.from({ length: days }, (_, i) => (isPayday(i + 1) ? (v.payday ?? 1) : 1));
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      // ±20% month-to-month variation in the number of purchases.
      const count = Math.max(0, Math.round(v.perMonth * (0.8 + 0.4 * r())));
      for (let i = 0; i < count; i++) {
        let pick = r() * totalWeight;
        let day = 1;
        for (; day < days && pick >= weights[day - 1]; day++) pick -= weights[day - 1];
        const merchant = v.merchants[Math.floor(r() * v.merchants.length)];
        tx.push({ date: `${month}-${pad(day)}`, merchant, category: v.category, amount: round05(v.min + r() * (v.max - v.min)) });
      }
    }
  }
  for (const o of plan.oneOff ?? []) tx.push({ ...o });
  return tx.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.merchant.localeCompare(b.merchant)));
}

/** A fund order priced off the illustrative index: `basePrice` per unit at index 100. */
export function fundTrade(
  date: string,
  account: InvestmentTrade["account"],
  instrument: string,
  side: InvestmentTrade["side"],
  amount: number,
  basePrice: number,
): InvestmentTrade {
  const level = MARKET_INDEX[date.slice(0, 7)] ?? 100;
  const price = Math.round(basePrice * (level / 100) * 100) / 100;
  return { date, account, instrument, kind: "fund", side, amount, price, units: Math.round((amount / price) * 1000) / 1000 };
}

/** A single-stock order at a quoted price. */
export function stockTrade(date: string, instrument: string, side: InvestmentTrade["side"], amount: number, price: number): InvestmentTrade {
  return { date, account: "broker", instrument, kind: "stock", side, amount, price, units: Math.round((amount / price) * 1000) / 1000 };
}
