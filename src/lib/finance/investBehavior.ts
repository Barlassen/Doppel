import { defaultHealthPremium } from "./canton";
import type { InvestmentTrade, Profile, Provenance, Transaction } from "./types";

/**
 * ILLUSTRATIVE market index, NOT real market data: a made-up monthly close (CHF, start = 100 in Jan 2026) shaped
 * like a global equity index with one drawdown in summer 2026 (−16% from the June high at the August low). It is
 * only used to tell whether a trade happened in a drawdown, and to mark fund positions between trades.
 * Months outside the series count as "no drawdown".
 */
export const MARKET_INDEX: Readonly<Record<string, number>> = {
  "2025-10": 92,
  "2025-11": 94,
  "2025-12": 95,
  "2026-01": 100,
  "2026-02": 101,
  "2026-03": 99,
  "2026-04": 102,
  "2026-05": 103,
  "2026-06": 105,
  "2026-07": 94,
  "2026-08": 88,
  "2026-09": 91,
  "2026-10": 97,
  "2026-11": 102,
};

/** A month counts as a drawdown when the index is at least this far below its running high. */
export const DRAWDOWN_THRESHOLD = 0.1;
/** A single-stock buy counts as chasing a peak when the stock later traded at least this much lower. */
export const PEAK_CHASE_DROP = 0.2;
/** Cash above this many months of spending is "idle" (same buffer as the solver's invest lever). */
export const IDLE_BUFFER_MONTHS = 3;

const INDEX_MONTHS = Object.keys(MARKET_INDEX).sort();

/** Index drawdown in a month: 1 − close / running high (0 when the month is outside the series). */
export function drawdownAt(month: string): number {
  const level = MARKET_INDEX[month];
  if (level === undefined) return 0;
  let peak = 0;
  for (const m of INDEX_MONTHS) {
    if (m > month) break;
    peak = Math.max(peak, MARKET_INDEX[m]);
  }
  return peak > 0 ? 1 - level / peak : 0;
}

const monthOf = (date: string) => date.slice(0, 7);
/** "2026-08" → 202608, the raw number a `{when:ym}` placeholder formats. */
export const ymNumber = (month: string) => Number(month.slice(0, 4)) * 100 + Number(month.slice(5, 7));

/** Average monthly spending over the transaction window (transfers to investments excluded). */
export function monthlySpend(transactions: Transaction[]): { months: number; average: number; rent: number } {
  const months = new Set(transactions.map((t) => monthOf(t.date))).size;
  if (!months) return { months: 0, average: 0, rent: 0 };
  const spend = transactions.filter((t) => t.category !== "investing").reduce((s, t) => s + t.amount, 0);
  const rent = transactions.filter((t) => t.category === "housing").reduce((s, t) => s + t.amount, 0);
  return { months, average: spend / months, rent: rent / months };
}

/** Names a mandatory health insurer is booked under (statement text in the four languages, and the large Swiss insurers). */
const HEALTH_INSURER = /health insurance|krankenkasse|krankenversicherung|assurance[- ]maladie|caisse[- ]maladie|sa[gğ]l[iı]k sigortas[iı]|\bkvg\b|\blamal\b|\b(?:css|helsana|swica|sanitas|visana|concordia|assura|sympany|atupri|kpt|ökk|oekk|egk)\b|groupe mutuel/i;

/**
 * The person's own monthly health-insurance premium as their transactions show it: the average of the months in
 * which a health insurer was paid. Undefined when the history has no such payment (the engine then uses the
 * canton's mean premium, see canton.ts).
 */
export function observedHealthPremium(transactions: readonly Transaction[]): number | undefined {
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (t.category !== "insurance" || !HEALTH_INSURER.test(t.merchant)) continue;
    byMonth.set(monthOf(t.date), (byMonth.get(monthOf(t.date)) ?? 0) + t.amount);
  }
  if (!byMonth.size) return undefined;
  let total = 0;
  for (const v of byMonth.values()) total += v;
  return Math.round(total / byMonth.size);
}

/**
 * The monthly health premium the twin uses for a profile, and whose figure it is:
 *  1. `profile.healthPremiumMonth` when set (`provenance.healthPremiumMonth`, else `user`),
 *  2. else the premium the transactions show (`derived`),
 *  3. else the canton's mean premium for one person (`doppel_default`).
 * The simulator and the budget lines use this one rule; show the same value wherever the premium is displayed.
 */
export function healthPremiumOf(p: Pick<Profile, "healthPremiumMonth" | "transactions" | "canton" | "age" | "provenance">): { value: number; provenance: Provenance | "user" } {
  if (p.healthPremiumMonth !== undefined) return { value: p.healthPremiumMonth, provenance: p.provenance?.healthPremiumMonth ?? "user" };
  const observed = observedHealthPremium(p.transactions ?? []);
  if (observed !== undefined) return { value: observed, provenance: "derived" };
  return { value: defaultHealthPremium(p), provenance: "doppel_default" };
}

export interface InvestBehavior {
  /** Months in the observation window (distinct transaction months, else distinct trade months). */
  months: number;
  /** Net income minus average monthly spending. */
  surplusMonth: number;
  /** Average net CHF/month into the broker account (buys − sells). */
  brokerNetMonth: number;
  /** Average CHF/month into pillar 3a. */
  p3aMonth: number;
  /** Months with at least one broker buy. */
  buyMonths: number;
  /** Share of the surplus left after pillar 3a that went into the broker account (0..1). */
  investShare: number;
  /** Paid into pillar 3a in at least half of the months. */
  contributes3a: boolean;
  soldInDrawdown: boolean;
  /** Share of the broker portfolio sold during the drawdown (0..1). */
  drawdownSellPct: number;
  /** The drawdown the sale happened in: month of the first sell, and the deepest index drawdown of that episode. */
  sell?: { month: string; amount: number; drawdown: number };
  /** Bought during a drawdown and sold nothing in it. */
  dip?: { month: string; amount: number; drawdown: number };
  /** A single stock bought at its highest observed price that later traded ≥ 20% lower. */
  chase?: { instrument: string; month: string; amount: number; price: number; drop: number };
}

interface Position {
  units: number;
  /** Last known price per unit, and the month it was observed in (marked forward with the index). */
  price: number;
  month: string;
}

/**
 * Investing behaviour from data: transactions (for the surplus) + trades + the illustrative index.
 * Pure, deterministic, 0 tokens. The engine's `investShare`, `contributes3a` and `history` are set from this.
 */
export function deriveInvestBehavior(input: {
  netIncomeMonth: number;
  transactions: Transaction[];
  trades: InvestmentTrade[];
}): InvestBehavior {
  const trades = [...input.trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const spend = monthlySpend(input.transactions);
  const months = spend.months || new Set(trades.map((t) => monthOf(t.date))).size || 1;
  const surplusMonth = input.netIncomeMonth - spend.average;

  let brokerBuys = 0;
  let brokerSells = 0;
  let p3a = 0;
  const p3aMonths = new Set<string>();
  const buyMonths = new Set<string>();
  for (const t of trades) {
    if (t.account === "3a") {
      const signed = t.side === "buy" ? t.amount : -t.amount;
      p3a += signed;
      if (t.side === "buy") p3aMonths.add(monthOf(t.date));
    } else if (t.side === "buy") {
      brokerBuys += t.amount;
      buyMonths.add(monthOf(t.date));
    } else brokerSells += t.amount;
  }
  const brokerNetMonth = (brokerBuys - brokerSells) / months;
  const p3aMonth = p3a / months;
  const free = surplusMonth - Math.max(0, p3aMonth);
  const investShare = free > 0 ? clamp(brokerNetMonth / free, 0, 1) : brokerNetMonth > 0 ? 1 : 0;
  const contributes3a = p3aMonths.size > 0 && p3aMonths.size * 2 >= months;

  // Walk the broker trades: positions marked with the index, drawdown episodes, dip buys, peak chases.
  const positions = new Map<string, Position>();
  const markIndex = (month: string) => MARKET_INDEX[month];
  const value = (month: string, override?: { instrument: string; price?: number }) => {
    let total = 0;
    for (const [name, pos] of positions) {
      let price = pos.price;
      if (override && name === override.instrument && override.price) price = override.price;
      else {
        const from = markIndex(pos.month);
        const to = markIndex(month);
        if (from && to) price = pos.price * (to / from);
      }
      total += pos.units * price;
    }
    return total;
  };

  interface Episode {
    month: string;
    sold: number;
    bought: number;
    valueBefore: number;
    drawdown: number;
  }
  const episodes: Episode[] = [];
  let current: Episode | null = null;
  let lastMonth = "";
  for (const t of trades) {
    if (t.account !== "broker") continue;
    const month = monthOf(t.date);
    const dd = drawdownAt(month);
    const inDrawdown = dd >= DRAWDOWN_THRESHOLD;
    // A new episode starts when a drawdown month follows a non-drawdown month (or there is none yet).
    if (inDrawdown && (!current || !consecutiveDrawdown(lastMonth, month))) {
      current = { month, sold: 0, bought: 0, valueBefore: 0, drawdown: dd };
      episodes.push(current);
    }
    if (!inDrawdown) current = null;
    lastMonth = month;

    const unitPrice = t.price ?? (t.units ? t.amount / t.units : markIndex(month) ?? 100);
    const units = t.units ?? t.amount / unitPrice;
    if (current) {
      current.drawdown = Math.max(current.drawdown, episodeDepth(current.month, month));
      if (t.side === "sell" && current.sold === 0) current.valueBefore = value(month, { instrument: t.instrument, price: t.price });
      if (t.side === "sell") current.sold += t.amount;
      else current.bought += t.amount;
    }
    const pos = positions.get(t.instrument) ?? { units: 0, price: unitPrice, month };
    pos.units = Math.max(0, pos.units + (t.side === "buy" ? units : -units));
    pos.price = unitPrice;
    pos.month = month;
    positions.set(t.instrument, pos);
  }

  const sale = episodes.filter((e) => e.sold > 0).sort((a, b) => b.sold - a.sold)[0];
  const soldInDrawdown = !!sale;
  const drawdownSellPct = sale && sale.valueBefore > 0 ? round2(clamp(sale.sold / sale.valueBefore, 0, 1)) : 0;
  const dipEpisode = soldInDrawdown ? undefined : episodes.filter((e) => e.bought > 0).sort((a, b) => b.bought - a.bought)[0];

  // Peak chase: a single-stock buy at the highest price seen for it, later ≥ 20% lower.
  let chase: InvestBehavior["chase"];
  for (const [i, t] of trades.entries()) {
    if (t.account !== "broker" || t.kind !== "stock" || t.side !== "buy" || !t.price) continue;
    const later = trades.slice(i + 1).filter((x) => x.instrument === t.instrument && x.price);
    const all = trades.filter((x) => x.instrument === t.instrument && x.price).map((x) => x.price!);
    if (!later.length || t.price < Math.max(...all)) continue;
    const low = Math.min(...later.map((x) => x.price!));
    const drop = 1 - low / t.price;
    if (drop >= PEAK_CHASE_DROP && (!chase || t.amount > chase.amount)) {
      chase = { instrument: t.instrument, month: monthOf(t.date), amount: t.amount, price: t.price, drop: round2(drop) };
    }
  }

  return {
    months,
    surplusMonth,
    brokerNetMonth,
    p3aMonth,
    buyMonths: buyMonths.size,
    investShare: round2(investShare),
    contributes3a,
    soldInDrawdown,
    drawdownSellPct,
    sell: sale ? { month: sale.month, amount: sale.sold, drawdown: round2(sale.drawdown) } : undefined,
    dip: dipEpisode ? { month: dipEpisode.month, amount: dipEpisode.bought, drawdown: round2(dipEpisode.drawdown) } : undefined,
    chase,
  };
}

/** Deepest drawdown from `from` to `to` (inclusive), months of the index series. */
function episodeDepth(from: string, to: string): number {
  let depth = 0;
  for (const m of INDEX_MONTHS) if (m >= from && m <= to) depth = Math.max(depth, drawdownAt(m));
  return depth;
}

/** True when every index month between `prev` and `month` is a drawdown month (same episode). */
function consecutiveDrawdown(prev: string, month: string): boolean {
  if (!prev) return false;
  for (const m of INDEX_MONTHS) if (m >= prev && m <= month && drawdownAt(m) < DRAWDOWN_THRESHOLD) return false;
  return true;
}

/**
 * Applies the data-derived inputs to a profile: `investShare`, `contributes3a` and `history`.
 * The finance engine itself is unchanged; only these inputs now come from the trades.
 */
export function withDerivedBehavior<P extends Profile>(p: P): P {
  const b = deriveInvestBehavior(p);
  return {
    ...p,
    investShare: b.investShare,
    contributes3a: b.contributes3a,
    history: { soldInDrawdown: b.soldInDrawdown, drawdownSellPct: b.drawdownSellPct },
  };
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
const round2 = (x: number) => Math.round(x * 100) / 100;
