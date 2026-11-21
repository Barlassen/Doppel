import type { BehaviorParams, Profile, Transaction } from "./types";
import { categoryMsg, merchantText } from "@/lib/data/merchants";
import type { Msg } from "@/lib/i18n/types";

export interface BehaviorInsight {
  id: string;
  title: Msg;
  detail: Msg;
  monthlyChf?: number;
}

export interface BehaviorProfile {
  params: BehaviorParams;
  paydaySpike: number;
  subscriptions: { merchant: string; monthly: number }[];
  discretionaryShare: number;
  insights: BehaviorInsight[];
  /** CHF per month of today's surplus that leaks to unplanned spending. */
  leakageChfMonth: number;
  /** Months of transaction history the baseline is computed on. */
  historyMonths: number;
  /** Snapped receipts vs. the 3-month baseline of discretionary spending. */
  thisMonth: { discretionary: number; total: number; count: number; baseline: number };
  /** One concrete place to find savings, derived from the transactions (used by the solver). */
  spendTip: Msg;
}

const DISCRETIONARY = new Set<Transaction["category"]>(["dining", "shopping", "travel", "subscriptions"]);
const PAYDAY = 25;

/**
 * Derives behaviour parameters from raw transactions + history. Pure, deterministic, 0 tokens.
 * The baseline uses the profile's transaction history only; snapped receipts (`extra`) feed the
 * "this month" figure so a single receipt cannot distort the 3-month pattern.
 */
export function analyzeBehavior(p: Profile, extra: Transaction[] = []): BehaviorProfile {
  const tx = p.transactions;
  const historyMonths = new Set(tx.map((t) => t.date.slice(0, 7))).size || 1;

  // 1) Payday spike: discretionary spend per day right after payday vs rest of month
  let after = 0;
  let before = 0;
  for (const t of tx) {
    if (!DISCRETIONARY.has(t.category)) continue;
    const day = Number(t.date.slice(8, 10));
    if (day >= PAYDAY || day <= 2) after += t.amount;
    else before += t.amount;
  }
  const afterDays = 9;
  const beforeDays = 22;
  const paydaySpike = before > 0 ? after / afterDays / (before / beforeDays) : 1;

  // 2) Recurring subscriptions (same merchant in ≥2 distinct months)
  const byMerchant = new Map<string, { months: Set<string>; total: number }>();
  for (const t of tx) {
    if (t.category !== "subscriptions") continue;
    const m = byMerchant.get(t.merchant) ?? { months: new Set(), total: 0 };
    m.months.add(t.date.slice(0, 7));
    m.total += t.amount;
    byMerchant.set(t.merchant, m);
  }
  const subscriptions = [...byMerchant.entries()]
    .filter(([, v]) => v.months.size >= 2)
    .map(([merchant, v]) => ({ merchant, monthly: Math.round(v.total / v.months.size) }))
    .sort((a, b) => b.monthly - a.monthly);

  const total = tx.reduce((s, t) => s + t.amount, 0) || 1;
  const disc = tx.filter((t) => DISCRETIONARY.has(t.category)).reduce((s, t) => s + t.amount, 0);
  const discretionaryShare = disc / total;

  const leakageRate = clamp(
    0.03 + Math.min(0.1, Math.max(0, paydaySpike - 1) * 0.03) + Math.max(0, discretionaryShare - 0.25) * 0.3,
    0,
    0.3,
  );
  const panicSellProb = p.history.soldInDrawdown ? clamp(0.3 + 0.6 * p.history.drawdownSellPct, 0, 0.95) : 0.08;
  const panicSellShare = p.history.soldInDrawdown ? clamp(p.history.drawdownSellPct, 0.1, 1) : 0.5;
  const params: BehaviorParams = { leakageRate, panicSellProb, panicSellShare, panicOutMonths: 6 };

  const surplus = Math.max(0, p.netIncomeMonth - p.expensesMonth);
  const leakageChfMonth = Math.round(leakageRate * surplus);

  const insights: BehaviorInsight[] = [];
  if (paydaySpike > 1.25) {
    const extraMonthly = Math.round(((after / afterDays - before / beforeDays) * afterDays) / historyMonths);
    insights.push({
      id: "payday",
      title: { key: "insight.paydayTitle", params: { x: paydaySpike } },
      detail: { key: "insight.paydayDetail", params: { x: paydaySpike } },
      monthlyChf: extraMonthly,
    });
  }
  if (leakageChfMonth > 0) {
    insights.push({
      id: "leak",
      title: { key: "insight.leakTitle", params: { rate: leakageRate } },
      detail: { key: "insight.leakDetail", params: { surplus } },
      monthlyChf: leakageChfMonth,
    });
  }
  if (subscriptions.length > 0) {
    const sum = subscriptions.reduce((s, x) => s + x.monthly, 0);
    insights.push({
      id: "subs",
      title: { key: "insight.subsTitle", params: { count: subscriptions.length } },
      detail: {
        key: "insight.subsList",
        params: { items: subscriptions.map((s): Msg => ({ key: "insight.subsItem", params: { merchant: merchantText(s.merchant), amount: s.monthly } })) },
      },
      monthlyChf: sum,
    });
  }
  if (p.history.soldInDrawdown) {
    insights.push({
      id: "panic",
      title: { key: "insight.panicTitle" },
      detail: { key: "insight.panicDetail", params: { sold: p.history.drawdownSellPct, prob: panicSellProb } },
    });
  }

  // Snapped receipts → "this month" vs the 3-month baseline of discretionary spending.
  const baseline = Math.round(disc / historyMonths);
  const thisMonth = {
    discretionary: Math.round(extra.filter((t) => DISCRETIONARY.has(t.category)).reduce((s, t) => s + t.amount, 0)),
    total: Math.round(extra.reduce((s, t) => s + t.amount, 0)),
    count: extra.length,
    baseline,
  };

  // Where would a spending cut come from? Payday spike first, then the biggest flexible category.
  let spendTip: Msg;
  if (paydaySpike > 1.25) spendTip = { key: "insight.tipPayday" };
  else {
    const byCat = new Map<string, number>();
    for (const t of tx) if (DISCRETIONARY.has(t.category)) byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    spendTip = top
      ? {
          key: "insight.tipCategory",
          params: { category: categoryMsg(top[0] as Transaction["category"]), amount: Math.round(top[1] / historyMonths) },
        }
      : { key: "insight.tipFixed" };
  }

  return { params, paydaySpike, subscriptions, discretionaryShare, insights, leakageChfMonth, historyMonths, thisMonth, spendTip };
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
