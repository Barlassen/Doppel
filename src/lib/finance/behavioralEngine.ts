import type { BehaviorParams, Profile, Transaction } from "./types";

export interface BehaviorInsight {
  id: string;
  title: string;
  detail: string;
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
  spendTip: string;
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
      title: `Payday spike ×${paydaySpike.toFixed(1)}`,
      detail: `In the week after payday you spend ${paydaySpike.toFixed(1)}× more per day on dining & shopping.`,
      monthlyChf: extraMonthly,
    });
  }
  if (leakageChfMonth > 0) {
    insights.push({
      id: "leak",
      title: `${Math.round(leakageRate * 100)}% of your surplus leaks`,
      detail: `Of the ≈ CHF ${surplus.toLocaleString("de-CH")} left each month, about this much is spent unplanned instead of saved.`,
      monthlyChf: leakageChfMonth,
    });
  }
  if (subscriptions.length > 0) {
    const sum = subscriptions.reduce((s, x) => s + x.monthly, 0);
    insights.push({
      id: "subs",
      title: `${subscriptions.length} recurring subscriptions`,
      detail: subscriptions.map((s) => `${s.merchant} ${s.monthly}`).join(" · "),
      monthlyChf: sum,
    });
  }
  if (p.history.soldInDrawdown) {
    insights.push({
      id: "panic",
      title: "Sells in drawdowns",
      detail: `Last big dip you sold ${Math.round(p.history.drawdownSellPct * 100)}% of your equities. Your twin assumes a ${Math.round(panicSellProb * 100)}% chance you do it again — and that you only buy back once the market is back at its old high.`,
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
  let spendTip: string;
  if (paydaySpike > 1.25) spendTip = "Your payday-week dining & shopping is the easiest place to find it.";
  else {
    const byCat = new Map<string, number>();
    for (const t of tx) if (DISCRETIONARY.has(t.category)) byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    spendTip = top
      ? `Your biggest flexible line is ${top[0]} (≈ CHF ${Math.round(top[1] / historyMonths).toLocaleString("de-CH")}/month); fixed costs like rent and insurance are the next lever.`
      : "Look at fixed costs first: rent, insurance and transport.";
  }

  return { params, paydaySpike, subscriptions, discretionaryShare, insights, leakageChfMonth, historyMonths, thisMonth, spendTip };
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
