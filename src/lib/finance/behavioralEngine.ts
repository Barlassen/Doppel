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
}

const DISCRETIONARY = new Set<Transaction["category"]>(["dining", "shopping", "travel", "subscriptions"]);
const PAYDAY = 25;

/** Derives behaviour parameters from raw transactions + history. Pure, deterministic, 0 tokens. */
export function analyzeBehavior(p: Profile, extra: Transaction[] = []): BehaviorProfile {
  const tx = [...p.transactions, ...extra];
  const months = new Set(tx.map((t) => t.date.slice(0, 7))).size || 1;

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

  const leakageRate = clamp(0.03 + Math.min(0.1, Math.max(0, paydaySpike - 1) * 0.03) + Math.max(0, discretionaryShare - 0.25) * 0.3, 0, 0.3);
  const panicSellProb = p.history.soldInDrawdown ? clamp(0.3 + 0.6 * p.history.drawdownSellPct, 0, 0.95) : 0.08;
  const params: BehaviorParams = { leakageRate, panicSellProb, panicOutMonths: 9 };

  const insights: BehaviorInsight[] = [];
  if (paydaySpike > 1.25) {
    const extraMonthly = Math.round(((after / afterDays - before / beforeDays) * afterDays) / months);
    insights.push({
      id: "payday",
      title: `Payday spike ×${paydaySpike.toFixed(1)}`,
      detail: `In the week after payday you spend ${paydaySpike.toFixed(1)}× more per day on dining & shopping.`,
      monthlyChf: extraMonthly,
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
      detail: `Last big dip you sold ${Math.round(p.history.drawdownSellPct * 100)}% of your equities. Your twin assumes a ${Math.round(panicSellProb * 100)}% chance you do it again.`,
    });
  }
  return { params, paydaySpike, subscriptions, discretionaryShare, insights };
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
