import type { BehaviorParams, Profile, Transaction } from "./types";
import { IDLE_BUFFER_MONTHS, deriveInvestBehavior, ymNumber } from "./investBehavior";
import { categoryMsg, merchantGroup, merchantText } from "@/lib/data/merchants";
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
 * "this month" figure so a single receipt cannot distort the multi-month pattern.
 * `p.history`, `p.investShare` and `p.contributes3a` are themselves derived from `p.trades` for the built-in
 * accounts (`withDerivedBehavior`); the trade insights below explain where they come from.
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
  // No transactions (e.g. a UBS synthetic profile): no habit is inferred. The engine keeps its neutral priors
  // (3% leakage floor, 8% panic-sell chance) and says so instead of presenting them as observed habits.
  if (tx.length === 0) {
    insights.push({
      id: "noHistory",
      title: { key: "ubs.noHistoryTitle" },
      detail: { key: "ubs.noHistoryDetail", params: { rate: leakageRate, prob: panicSellProb } },
    });
  }
  if (paydaySpike > 1.25) {
    const extraMonthly = Math.round(((after / afterDays - before / beforeDays) * afterDays) / historyMonths);
    insights.push({
      id: "payday",
      title: { key: "insight.paydayTitle", params: { x: paydaySpike } },
      detail: { key: "insight.paydayDetail", params: { x: paydaySpike } },
      monthlyChf: extraMonthly,
    });
  }
  if (leakageChfMonth > 0 && tx.length > 0) {
    insights.push({
      id: "leak",
      title: { key: "insight.leakTitle", params: { rate: leakageRate } },
      detail: { key: "insight.leakDetail", params: { surplus } },
      monthlyChf: leakageChfMonth,
    });
  }
  if (subscriptions.length > 0) {
    const sum = subscriptions.reduce((s, x) => s + x.monthly, 0);
    const items = subscriptions.map((s): Msg => ({ key: "insight.subsItem", params: { merchant: merchantText(s.merchant), amount: s.monthly } }));
    // Overlap: two or more video (or music) streaming services at the same time.
    const groups = new Map<string, number>();
    for (const s of subscriptions) {
      const g = merchantGroup(s.merchant);
      if (g === "videoStreaming" || g === "musicStreaming") groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    const overlapping = [...groups.values()].filter((n) => n >= 2).reduce((s, n) => s + n, 0);
    insights.push({
      id: "subs",
      title: { key: "insight.subsTitle", params: { count: subscriptions.length } },
      detail: overlapping
        ? { key: "insight.subsOverlap", params: { items, count: overlapping } }
        : { key: "insight.subsList", params: { items } },
      monthlyChf: sum,
    });
  }

  // Food delivery: four or more orders a month.
  const delivery = tx.filter((t) => merchantGroup(t.merchant) === "delivery");
  const deliveryPerMonth = delivery.length / historyMonths;
  if (deliveryPerMonth >= 4) {
    insights.push({
      id: "delivery",
      title: { key: "insight.deliveryTitle", params: { count: Math.round(deliveryPerMonth) } },
      detail: { key: "insight.deliveryDetail", params: { items: [...new Set(delivery.map((t) => t.merchant))].sort() } },
      monthlyChf: Math.round(delivery.reduce((s, t) => s + t.amount, 0) / historyMonths),
    });
  }

  // Investing, from the trades (same derivation that sets investShare / contributes3a / history).
  const inv = p.trades.length ? deriveInvestBehavior(p) : null;
  if (p.history.soldInDrawdown) {
    insights.push(
      inv?.sell && inv.drawdownSellPct === p.history.drawdownSellPct
        ? {
            id: "panic",
            title: { key: "insight.panicDataTitle", params: { sold: inv.drawdownSellPct, when: ymNumber(inv.sell.month) } },
            detail: { key: "insight.panicDataDetail", params: { dd: inv.sell.drawdown, prob: panicSellProb } },
          }
        : {
            id: "panic",
            title: { key: "insight.panicTitle" },
            detail: { key: "insight.panicDetail", params: { sold: p.history.drawdownSellPct, prob: panicSellProb } },
          },
    );
  }
  if (inv?.dip) {
    insights.push({
      id: "dip",
      title: { key: "insight.dipTitle", params: { when: ymNumber(inv.dip.month) } },
      detail: { key: "insight.dipDetail", params: { amount: Math.round(inv.dip.amount), dd: inv.dip.drawdown } },
    });
  }
  if (inv?.chase) {
    const c = inv.chase;
    insights.push({
      id: "chase",
      title: { key: "insight.chaseTitle", params: { instrument: c.instrument } },
      detail: { key: "insight.chaseDetail", params: { amount: Math.round(c.amount), when: ymNumber(c.month), price: c.price, drop: c.drop } },
    });
  }
  if (inv && inv.buyMonths > 0) {
    const regular = inv.buyMonths >= inv.months;
    insights.push({
      id: "invest",
      title: regular ? { key: "insight.investRegularTitle", params: { share: p.investShare } } : { key: "insight.investSporadicTitle" },
      detail: regular
        ? { key: "insight.investRegularDetail", params: { months: inv.months, monthly: Math.round(inv.brokerNetMonth) } }
        : {
            key: "insight.investSporadicDetail",
            params: { active: inv.buyMonths, months: inv.months, monthly: Math.round(inv.brokerNetMonth), share: p.investShare },
          },
    });
  } else if (!p.trades.length && p.portfolio === 0 && p.pillar3a === 0) {
    insights.push({ id: "noInvest", title: { key: "insight.noInvestTitle" }, detail: { key: "insight.noInvestDetail", params: { months: historyMonths } } });
  }
  const buffer = IDLE_BUFFER_MONTHS * p.expensesMonth;
  const idle = Math.floor((p.cash - buffer) / 100) * 100;
  if (inv && idle >= 1000) {
    insights.push({
      id: "idle",
      title: { key: "insight.idleTitle", params: { amount: idle } },
      detail: { key: "insight.idleDetail", params: { months: IDLE_BUFFER_MONTHS, buffer: Math.round(buffer) } },
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
