import { categoryMsg, merchantGroup, merchantText, type MerchantGroup } from "@/lib/data/merchants";
import type { Profile, Transaction, TransactionCategory } from "@/lib/finance/types";
import type { StatementSummary } from "@/lib/import";
import { msg, type Msg, type Text } from "@/lib/i18n/types";

/**
 * Near-term reading of the statement: what recurs, what changed, what next month looks like. Pure and
 * deterministic (0 tokens, no clock: `now` defaults to the last booking date). Every figure carries its basis:
 * "observed" = read from the bookings, "estimated" = arithmetic on top of them.
 */

export type Basis = "observed" | "estimated";
export interface Figure {
  value: number;
  basis: Basis;
}
export type RecurringCadence = "monthly" | "yearly" | "other";

export interface RecurringPayment {
  merchant: string;
  /** Translatable name for the built-in generic merchants, the brand name otherwise. */
  label: Text;
  category: TransactionCategory;
  categoryLabel: Msg;
  cadence: RecurringCadence;
  cadenceLabel: Msg;
  /** Typical amount of one payment (median of the bookings), CHF. Observed. */
  amount: number;
  /** Extrapolated to twelve months. Estimated. */
  yearlyCost: number;
  /** Calendar months with a booking. */
  monthsSeen: number;
  occurrences: number;
  lastDate: string;
  /** First expected date after `now`, ISO. Estimated. */
  nextDate: string;
  subscription: boolean;
  family?: MerchantGroup;
}

export interface Overlap {
  family: MerchantGroup;
  merchants: string[];
  /** Yearly cost of the cheapest service of the family: what dropping one saves at least. */
  yearlySaving: number;
  label: Msg;
}

export interface CategoryChange {
  category: TransactionCategory;
  label: Msg;
  latest: number;
  /** Average of the earlier full months. */
  usual: number;
  delta: number;
  /** delta / usual; null when the category did not exist before. */
  pct: number | null;
  /** Standard deviation of the earlier months (0 with fewer than two). */
  sd: number;
}

export interface MonthSpend {
  /** yyyy-mm */
  month: string;
  /** False for a first or last month the bookings only partly cover. */
  full: boolean;
  total: number;
  byCategory: Partial<Record<TransactionCategory, number>>;
}

export interface UpcomingPayment {
  date: string;
  merchant: string;
  label: Text;
  amount: number;
}

export interface SpendingInsights {
  /** ISO date the reading is anchored on. */
  asOf: string;
  recurring: {
    items: RecurringPayment[];
    subscriptions: number;
    yearlyTotal: Figure;
    monthlyTotal: Figure;
    overlaps: Overlap[];
  };
  monthOverMonth: {
    months: MonthSpend[];
    /** Latest full month (yyyy-mm) and the earlier full months it is compared with; null without two full months. */
    latest: string | null;
    comparedWith: string[];
    /** Changes that clear the noise rule, largest first. */
    changes: CategoryChange[];
    /** Every category of the latest month, including the ones inside the noise. */
    all: CategoryChange[];
    largest: Transaction[];
    rule: { minChf: number; minPct: number; sd: number; label: Msg };
  };
  forecast: {
    /** yyyy-mm */
    month: string;
    income: Figure & { source: "salary" | "takeHome"; label: Msg };
    fixed: Figure;
    variable: Figure & { min: number; max: number; months: number };
    /** income − fixed − variable. */
    result: Figure & { low: number; high: number };
    /** Dated payments in the 35 days after `asOf`. */
    upcoming: UpcomingPayment[];
    upcomingDays: number;
  };
  runway: {
    cash: number;
    monthlySpend: Figure;
    months: Figure;
    /** First month (yyyy-mm) the balance would be below zero without income; null when nothing is spent. */
    belowZero: string | null;
    label: Msg;
  };
}

/** Noise rule for month-over-month changes. */
export const NOISE_MIN_CHF = 30;
export const NOISE_MIN_PCT = 0.2;
export const NOISE_SD = 2;
export const UPCOMING_DAYS = 35;
/** A recurring payment's amounts stay within this share of their median. */
const AMOUNT_TOLERANCE = 0.1;

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
const pad = (n: number) => String(n).padStart(2, "0");
const ymOf = (iso: string) => iso.slice(0, 7);
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayGap = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86_400_000);

function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const mean = sum(xs) / xs.length;
  return Math.sqrt(sum(xs.map((x) => (x - mean) ** 2)) / (xs.length - 1));
}

/** `iso` moved by whole months, keeping the day of the month where the target month has it. */
function addMonths(iso: string, months: number, day = Number(iso.slice(8, 10))): string {
  const index = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, daysIn(y, m)))}`;
}
const ymAdd = (ym: string, months: number) => addMonths(`${ym}-01`, months).slice(0, 7);

/** Every expected date of a payment in (from, to], ISO ascending. */
function expectedDates(r: Pick<RecurringPayment, "cadence" | "lastDate"> & { gapDays: number }, from: string, to: string): string[] {
  const out: string[] = [];
  const day = Number(r.lastDate.slice(8, 10));
  for (let i = 1; i <= 240; i++) {
    const date =
      r.cadence === "monthly" ? addMonths(r.lastDate, i, day)
      : r.cadence === "yearly" ? addMonths(r.lastDate, 12 * i, day)
      : isoOf(utc(r.lastDate) + i * r.gapDays * 86_400_000);
    if (date > to) break;
    if (date > from) out.push(date);
  }
  return out;
}

type Detected = RecurringPayment & { gapDays: number };

/**
 * Recurring payments: one merchant, two or more bookings, amounts within ±10% of their median and an even rhythm
 * (every 26 to 35 days = monthly, 350 to 380 = yearly, any other even gap with three bookings = other). When the
 * statement summary is available its recurring-cost kinds decide what counts as a subscription.
 */
function detectRecurring(tx: readonly Transaction[], asOf: string, summary?: StatementSummary): Detected[] {
  const kinds = new Map((summary?.fixed.items ?? []).map((item) => [item.merchant.toLowerCase(), item.kind] as const));
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of tx) {
    const list = byMerchant.get(t.merchant);
    if (list) list.push(t);
    else byMerchant.set(t.merchant, [t]);
  }
  const out: Detected[] = [];
  for (const [merchant, rows] of byMerchant) {
    if (rows.length < 2) continue;
    const list = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const typical = median(list.map((t) => t.amount));
    if (typical <= 0 || list.some((t) => Math.abs(t.amount - typical) > AMOUNT_TOLERANCE * typical)) continue;
    const gaps = list.slice(1).map((t, i) => dayGap(list[i].date, t.date));
    const gap = median(gaps);
    const even = Math.max(...gaps) - Math.min(...gaps) <= 10;
    let cadence: RecurringCadence;
    if (gap >= 26 && gap <= 35 && Math.max(...gaps) <= 66 && Math.min(...gaps) >= 20) cadence = "monthly";
    else if (gap >= 350 && gap <= 380 && even) cadence = "yearly";
    else if (list.length >= 3 && even && gap >= 6) cadence = "other";
    else continue;
    const last = list[list.length - 1];
    const amount = round2(typical);
    const base = { cadence, lastDate: last.date, gapDays: Math.round(gap) };
    const horizon = isoOf(utc(asOf) + 800 * 86_400_000);
    const kind = kinds.get(merchant.toLowerCase());
    out.push({
      ...base,
      merchant,
      label: merchantText(merchant),
      category: last.category,
      categoryLabel: categoryMsg(last.category),
      cadenceLabel: msg(`insights.cadence.${cadence}`),
      amount,
      yearlyCost: round2(cadence === "monthly" ? 12 * amount : cadence === "yearly" ? amount : (365 / base.gapDays) * amount),
      monthsSeen: new Set(list.map((t) => ymOf(t.date))).size,
      occurrences: list.length,
      nextDate: expectedDates(base, asOf, horizon)[0] ?? asOf,
      subscription: last.category === "subscriptions" || kind === "subscription",
      family: merchantGroup(merchant),
    });
  }
  return out.sort((a, b) => b.yearlyCost - a.yearlyCost || a.merchant.localeCompare(b.merchant));
}

function publicItem(r: Detected): RecurringPayment {
  const item: RecurringPayment & { gapDays?: number } = { ...r };
  delete item.gapDays;
  return item;
}

const FAMILY_LABEL: Partial<Record<MerchantGroup, "insights.overlapVideo" | "insights.overlapMusic">> = {
  videoStreaming: "insights.overlapVideo",
  musicStreaming: "insights.overlapMusic",
};

function findOverlaps(items: readonly RecurringPayment[]): Overlap[] {
  const out: Overlap[] = [];
  for (const family of Object.keys(FAMILY_LABEL) as MerchantGroup[]) {
    const members = items.filter((r) => r.subscription && r.family === family);
    if (members.length < 2) continue;
    out.push({
      family,
      merchants: members.map((r) => r.merchant),
      yearlySaving: Math.min(...members.map((r) => r.yearlyCost)),
      label: msg(FAMILY_LABEL[family]!, { count: members.length }),
    });
  }
  return out;
}

/** The insights for one profile; `undefined` when it has no transactions. */
export function spendingInsights(profile: Profile, summary?: StatementSummary, now?: Date): SpendingInsights | undefined {
  // Spending only: transfers to a broker are not consumption (trades are read by the behavioural engine).
  const tx = profile.transactions.filter((t) => t.amount > 0 && t.category !== "investing");
  if (!tx.length) return undefined;
  const sorted = [...tx].sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant) || a.amount - b.amount);
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const asOf = now ? isoOf(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) : last;

  // ---- Recurring ----
  const detected = detectRecurring(sorted, asOf, summary);
  const recurringNames = new Set(detected.map((r) => r.merchant));
  const yearlyTotal = round2(sum(detected.map((r) => r.yearlyCost)));

  // ---- Months ----
  const nowYm = ymOf(asOf);
  const dataEnd = last < asOf ? last : asOf;
  const monthKeys = [...new Set(sorted.map((t) => ymOf(t.date)))].sort();
  const isFull = (ym: string) => {
    if (ym === ymOf(first) && Number(first.slice(8, 10)) > 5) return false;
    if (ym < ymOf(dataEnd)) return true;
    // The last month counts when the bookings reach its last three days, or the anchor date is already past it.
    return ym < nowYm || Number(dataEnd.slice(8, 10)) >= daysIn(Number(ym.slice(0, 4)), Number(ym.slice(5, 7))) - 3;
  };
  const months: MonthSpend[] = monthKeys.map((month) => {
    const rows = sorted.filter((t) => ymOf(t.date) === month);
    const byCategory: Partial<Record<TransactionCategory, number>> = {};
    for (const t of rows) byCategory[t.category] = round2((byCategory[t.category] ?? 0) + t.amount);
    return { month, full: isFull(month), total: round2(sum(rows.map((t) => t.amount))), byCategory };
  });
  const fullMonths = months.filter((m) => m.full);
  const latest = fullMonths.length >= 2 ? fullMonths[fullMonths.length - 1] : null;
  const earlier = latest ? fullMonths.slice(0, -1) : [];

  const all: CategoryChange[] = [];
  if (latest) {
    const categories = [...new Set(fullMonths.flatMap((m) => Object.keys(m.byCategory) as TransactionCategory[]))].sort();
    for (const category of categories) {
      const history = earlier.map((m) => m.byCategory[category] ?? 0);
      const usual = round2(sum(history) / history.length);
      const value = latest.byCategory[category] ?? 0;
      const delta = round2(value - usual);
      all.push({ category, label: categoryMsg(category), latest: value, usual, delta, pct: usual > 0 ? delta / usual : null, sd: round2(stdev(history)) });
    }
    all.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.category.localeCompare(b.category));
  }
  const clears = (c: CategoryChange) =>
    Math.abs(c.delta) >= NOISE_MIN_CHF && (c.pct === null || Math.abs(c.pct) >= NOISE_MIN_PCT || (c.sd > 0 && Math.abs(c.delta) > NOISE_SD * c.sd));
  const largest = latest
    ? sorted.filter((t) => ymOf(t.date) === latest.month).sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant)).slice(0, 3)
    : [];

  // ---- Forecast ----
  const forecastMonth = ymAdd(nowYm, 1);
  const monthEnd = addMonths(`${forecastMonth}-01`, 0, 31);
  const beforeMonth = addMonths(`${nowYm}-01`, 0, 31);
  const fixed = round2(sum(detected.map((r) => expectedDates(r, beforeMonth, monthEnd).length * r.amount)));
  // Variable = everything that is not a detected recurring payment, per full month (all months when none is full).
  const basisMonths = (fullMonths.length ? fullMonths : months).map((m) => m.month);
  const variableByMonth = basisMonths.map((month) =>
    round2(sum(sorted.filter((t) => ymOf(t.date) === month && !recurringNames.has(t.merchant)).map((t) => t.amount))),
  );
  const variable = round2(median(variableByMonth));
  const variableMin = Math.min(...variableByMonth);
  const variableMax = Math.max(...variableByMonth);
  const salary = round2(sum((summary?.income.sources ?? []).filter((s) => s.regular).map((s) => s.monthlyAvg)));
  const income: SpendingInsights["forecast"]["income"] = salary > 0
    ? { value: salary, basis: "observed", source: "salary", label: msg("insights.incomeSalary") }
    : { value: round2(profile.netIncomeMonth), basis: "estimated", source: "takeHome", label: msg("insights.incomeTakeHome") };
  const upcomingEnd = isoOf(utc(asOf) + UPCOMING_DAYS * 86_400_000);
  const upcoming: UpcomingPayment[] = detected
    .flatMap((r) => expectedDates(r, asOf, upcomingEnd).map((date) => ({ date, merchant: r.merchant, label: r.label, amount: r.amount })))
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount || a.merchant.localeCompare(b.merchant));

  // ---- Runway ----
  const spendMonths = fullMonths.length ? fullMonths : months;
  const monthlySpend = round2(sum(spendMonths.map((m) => m.total)) / spendMonths.length);
  const cash = Math.max(0, profile.cash);
  const runwayMonths = monthlySpend > 0 ? cash / monthlySpend : 0;

  return {
    asOf,
    recurring: {
      items: detected.map(publicItem),
      subscriptions: detected.filter((r) => r.subscription).length,
      yearlyTotal: { value: yearlyTotal, basis: "estimated" },
      monthlyTotal: { value: round2(yearlyTotal / 12), basis: "estimated" },
      overlaps: findOverlaps(detected),
    },
    monthOverMonth: {
      months,
      latest: latest?.month ?? null,
      comparedWith: earlier.map((m) => m.month),
      changes: all.filter(clears),
      all,
      largest,
      rule: {
        minChf: NOISE_MIN_CHF,
        minPct: NOISE_MIN_PCT,
        sd: NOISE_SD,
        label: msg("insights.noiseRule", { min: NOISE_MIN_CHF, pct: NOISE_MIN_PCT, sd: NOISE_SD }),
      },
    },
    forecast: {
      month: forecastMonth,
      income,
      fixed: { value: fixed, basis: "estimated" },
      variable: { value: variable, basis: "estimated", min: variableMin, max: variableMax, months: variableByMonth.length },
      result: {
        value: round2(income.value - fixed - variable),
        basis: "estimated",
        low: round2(income.value - fixed - variableMax),
        high: round2(income.value - fixed - variableMin),
      },
      upcoming,
      upcomingDays: UPCOMING_DAYS,
    },
    runway: {
      cash,
      monthlySpend: { value: monthlySpend, basis: "observed" },
      months: { value: Math.round(runwayMonths * 10) / 10, basis: "estimated" },
      belowZero: monthlySpend > 0 ? ymAdd(nowYm, Math.floor(runwayMonths) + 1) : null,
      label: msg("insights.runwayNote"),
    },
  };
}
