import type { Profile, TransactionCategory } from "@/lib/finance/types";
import type { StatementSummary } from "@/lib/import";
import { msg, type Msg } from "@/lib/i18n/types";

/**
 * "Where my money goes": one typical month of an account, from its own bookings and trades.
 *
 * Pure and deterministic, 0 tokens. Every figure is CHF per month; the UI multiplies by 12 for the year view.
 * Invariants (checked by `scripts/moneyflow-check.ts`):
 *   sum(fixed rows) + sum(variable rows) = spent
 *   sum(saved rows, the shortfall counted negative) = saved = income − spent
 */

export type FlowGroup = "fixed" | "variable" | "saved";
/** The five parts of the stacked bar. */
export type FlowSegment = "housing" | "fixed" | "everyday" | "invest" | "left";

export interface FlowMerchant {
  merchant: string;
  monthly: number;
}

export interface FlowRow {
  id: string;
  group: FlowGroup;
  segment: FlowSegment;
  label: Msg;
  /** CHF per month, never negative. A shortfall row carries the missing amount and `shortfall: true`. */
  monthly: number;
  /** Share of take-home income, 0..1 (0 without income). */
  share: number;
  /** Largest payees, biggest first. */
  merchants: FlowMerchant[];
  shortfall?: boolean;
}

export interface MoneyFlow {
  /** `bookings`: the account's transactions and trades. `profile`: the profile's income, rent and expenses fields. */
  source: "bookings" | "profile";
  /** Months of data the averages rest on (1 for the profile fallback). */
  months: number;
  income: number;
  spent: number;
  /** income − spent: what is invested plus what is left (negative = spending above income). */
  saved: number;
  invested: number;
  /** income − spent − invested. Negative = shortfall. */
  left: number;
  savingRate: number | null;
  rows: FlowRow[];
  segments: { id: FlowSegment; monthly: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (list: readonly number[]) => list.reduce((a, b) => a + b, 0);
const ALWAYS_FIXED: readonly TransactionCategory[] = ["housing", "insurance", "bills"];
const SEGMENTS: readonly FlowSegment[] = ["housing", "fixed", "everyday", "invest", "left"];
const MERCHANTS_SHOWN = 4;
const categoryLabel = (c: TransactionCategory): Msg => (c === "other" ? msg("data.categoryOther") : msg(`category.${c}`));

function finish(source: MoneyFlow["source"], months: number, incomeRaw: number, spending: Omit<FlowRow, "share">[], investing: Omit<FlowRow, "share">[]): MoneyFlow {
  const income = round2(Math.max(0, incomeRaw));
  const spent = round2(sum(spending.map((r) => r.monthly)));
  const invested = round2(sum(investing.map((r) => r.monthly)));
  const saved = round2(income - spent);
  const left = round2(saved - invested);
  const leftRow: Omit<FlowRow, "share"> = left < 0
    ? { id: "shortfall", group: "saved", segment: "left", label: msg("flow.shortfall"), monthly: -left, merchants: [], shortfall: true }
    : { id: "left", group: "saved", segment: "left", label: msg("flow.left"), monthly: left, merchants: [] };
  const order: Record<FlowGroup, number> = { fixed: 0, variable: 1, saved: 2 };
  const rows: FlowRow[] = [...spending.sort((a, b) => order[a.group] - order[b.group] || b.monthly - a.monthly), ...investing, leftRow]
    .filter((r) => r.monthly > 0 || r.id === "left")
    .map((r) => ({ ...r, share: income > 0 ? r.monthly / income : 0 }));
  const segments = SEGMENTS.map((id) => ({ id, monthly: round2(sum(rows.filter((r) => r.segment === id && !r.shortfall).map((r) => r.monthly))) }));
  return { source, months, income, spent, saved, invested, left, savingRate: income > 0 ? saved / income : null, rows, segments };
}

/**
 * The account's typical month. With a statement summary its recurring payees decide what is fixed (a transit pass,
 * a streaming plan) and its period and income are used; without one, housing, insurance and bills are fixed and the
 * rest is variable. An account without bookings falls back to the profile's income, rent and expenses.
 */
export function moneyFlow(profile: Profile, summary?: StatementSummary): MoneyFlow {
  const { transactions, trades } = profile;
  if (!transactions.length && !trades.length) {
    const health = Math.min(profile.healthPremiumMonth ?? 0, Math.max(0, profile.expensesMonth - profile.rentMonth));
    const living = Math.max(0, profile.expensesMonth - profile.rentMonth - health);
    return finish("profile", 1, profile.netIncomeMonth, [
      { id: "fixed:housing", group: "fixed", segment: "housing", label: categoryLabel("housing"), monthly: round2(Math.min(profile.rentMonth, profile.expensesMonth)), merchants: [] },
      { id: "fixed:insurance", group: "fixed", segment: "fixed", label: categoryLabel("insurance"), monthly: round2(health), merchants: [] },
      { id: "variable:living", group: "variable", segment: "everyday", label: msg("flow.living"), monthly: round2(living), merchants: [] },
    ], []);
  }

  const monthSet = new Set([...transactions.map((t) => t.date.slice(0, 7)), ...trades.map((t) => t.date.slice(0, 7))]);
  const months = Math.max(1, summary?.period.months ?? monthSet.size);
  const recurring = new Set(summary?.fixed.items.map((i) => i.merchant) ?? []);
  const brokerTrades = trades.filter((t) => t.account !== "3a");
  const trades3a = trades.filter((t) => t.account === "3a");

  // Spending rows: one per (group, category); totals are summed first and divided once, so rows add up exactly.
  const buckets = new Map<string, { group: FlowGroup; category: TransactionCategory; total: number; merchants: Map<string, number> }>();
  const transfers = new Map<string, number>();
  for (const t of transactions) {
    if (t.category === "investing") {
      // A transfer to a broker: it is saving, not spending. Counted only when no broker trades describe the same money.
      transfers.set(t.merchant, (transfers.get(t.merchant) ?? 0) + t.amount);
      continue;
    }
    const group: FlowGroup = ALWAYS_FIXED.includes(t.category) || recurring.has(t.merchant) ? "fixed" : "variable";
    const key = `${group}:${t.category}`;
    const bucket = buckets.get(key) ?? { group, category: t.category, total: 0, merchants: new Map<string, number>() };
    bucket.total += t.amount;
    bucket.merchants.set(t.merchant, (bucket.merchants.get(t.merchant) ?? 0) + t.amount);
    buckets.set(key, bucket);
  }
  const top = (m: ReadonlyMap<string, number>): FlowMerchant[] =>
    [...m].filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1]).slice(0, MERCHANTS_SHOWN).map(([merchant, total]) => ({ merchant, monthly: round2(total / months) }));
  const spending = [...buckets].map(([id, b]): Omit<FlowRow, "share"> => ({
    id,
    group: b.group,
    segment: b.category === "housing" ? "housing" : b.group === "fixed" ? "fixed" : "everyday",
    label: categoryLabel(b.category),
    monthly: round2(Math.max(0, b.total) / months),
    merchants: top(b.merchants),
  }));

  const net = (list: typeof trades) => Math.max(0, sum(list.map((t) => (t.side === "buy" ? t.amount : -t.amount))));
  const byInstrument = (list: typeof trades) => {
    const m = new Map<string, number>();
    for (const t of list) m.set(t.instrument, (m.get(t.instrument) ?? 0) + (t.side === "buy" ? t.amount : -t.amount));
    return top(m);
  };
  const investedTotal = brokerTrades.length ? net(brokerTrades) : Math.max(0, sum([...transfers.values()]));
  const investing: Omit<FlowRow, "share">[] = [
    { id: "saved:investing", group: "saved", segment: "invest", label: msg("flow.investing"), monthly: round2(investedTotal / months), merchants: brokerTrades.length ? byInstrument(brokerTrades) : top(transfers) },
    { id: "saved:pillar3a", group: "saved", segment: "invest", label: msg("flow.pillar3a"), monthly: round2(net(trades3a) / months), merchants: byInstrument(trades3a) },
  ];
  const income = summary && summary.income.monthlyAvg > 0 ? summary.income.monthlyAvg : profile.netIncomeMonth;
  return finish("bookings", months, income, spending, investing);
}

/** A decision's cost or income line as the outlook itemises it (CHF per month, today's CHF). */
export interface FlowDecisionLine {
  id: string;
  label: Msg;
  /** Signed for the budget: income positive, cost negative. */
  monthly: number;
}

export interface FlowAfter {
  lines: FlowDecisionLine[];
  income: number;
  spent: number;
  saved: number;
  savingRate: number | null;
}

/** The totals once the applied decisions' lines are added to the typical month. Undefined without lines. */
export function flowAfter(flow: MoneyFlow, lines: readonly FlowDecisionLine[]): FlowAfter | undefined {
  if (!lines.length) return undefined;
  const income = round2(flow.income + sum(lines.filter((l) => l.monthly > 0).map((l) => l.monthly)));
  const spent = round2(flow.spent - sum(lines.filter((l) => l.monthly < 0).map((l) => l.monthly)));
  const saved = round2(income - spent);
  return { lines: [...lines], income, spent, saved, savingRate: income > 0 ? saved / income : null };
}
