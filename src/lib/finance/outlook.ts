/**
 * Outlook: "where am I heading" and "what does this decision change", from the same seeded simulation as the
 * headline. Pure and deterministic; returns `Msg` descriptors and raw numbers only (the UI formats them).
 *
 * `outlook(profile, scenario)` simulates the scenario and, unless `baseline: null`, a baseline scenario (default:
 * the profile's own plan) with the HEADLINE seed and paths, so every difference is the decision, not luck.
 * All CHF amounts are in today's CHF.
 */
import type { Msg, Text } from "@/lib/i18n/types";
import { resolveEconomy, type EconomyId, type EconomyScenario } from "./economy";
import { compileLife, type LifeInputNeeded, type LifeParamUsed } from "./life";
import { simulate } from "./monteCarlo";
import { HEADLINE, baseScenario, simInputFor } from "./scenario";
import type { BehaviorParams, BudgetLine, DecisionKind, LifeEvent, Profile, Scenario, SimResult, YearBand } from "./types";

export interface BudgetItem {
  id: string;
  kind: BudgetLine["kind"];
  flow: "income" | "expense";
  label: Msg;
  /** CHF/month, today's CHF. */
  amount: number;
  eventId?: string;
  provenance?: BudgetLine["provenance"];
  source?: string;
  estimate?: boolean;
  /** Already inside another item (shown as an explanation, not part of the totals). */
  info?: boolean;
  /** Outcome drawn per future: share of futures in which the item applies; `amount` is the expected value. */
  prob?: number;
  /** A payment that builds an asset (mortgage amortisation): in the budget, but not a cost of the decision. */
  transfer?: boolean;
}

export interface BudgetSnapshot {
  month: number;
  year: number;
  /** Calendar month as yyyymm (the i18n `ym` format prints it). */
  ym: number;
  age: number;
  /** Take-home income per month (salary, partner, pension, allowances), today's CHF. */
  income: number;
  /** Spending per month incl. the decisions' cost lines. */
  expenses: number;
  surplus: number;
  items: BudgetItem[];
}

export interface HorizonPoint {
  key: "y1" | "y5" | "y10" | "goal" | "retirement";
  label: Msg;
  month: number;
  year: number;
  ym: number;
  age: number;
  p10: number;
  p50: number;
  p90: number;
  /** The same point in the baseline scenario and the median difference (scenario − baseline). */
  baseline?: { p10: number; p50: number; p90: number };
  deltaP50?: number;
}

export interface CashPoint {
  /** Today's CHF. */
  amount: number;
  month: number;
  year: number;
  ym: number;
  age: number;
}

export interface OutlookMarker {
  month: number;
  year: number;
  ym: number;
  age: number;
  kind: string;
  label: Text;
  eventId?: string;
  /** Today's CHF, when the marker is a payment. */
  amount?: number;
}

export interface DecisionOutlook {
  eventId: string;
  kind: DecisionKind | LifeEvent["type"];
  label: Text;
  month: number;
  /** True when the baseline scenario does not contain this event. */
  isNew: boolean;
  /** Itemised lines: constant stretches of each cost or income line (CHF/month, today's CHF). */
  lines: (Omit<BudgetItem, "amount"> & { phases: { fromMonth: number; toMonth: number; monthly: number }[]; total: number })[];
  oneOffs: { month: number; amount: number; label: Text; transfer?: boolean }[];
  /**
   * Net cost per year from the decision's first year (costs − incomes + one-offs paid), today's CHF. Payments that
   * build an asset (`transfer`: home equity, amortisation) are not costs and are left out.
   */
  byYear: { year: number; age: number; net: number }[];
  /** Average net cost per month in the first 12 months, the first 5 years and the first 10 years. */
  netMonthly: { year1: number; years5: number; years10: number };
  /** Sum of `byYear` over the simulated horizon. */
  totalNet: number;
}

export interface Outlook {
  startYear: number;
  age: number;
  economy: { id: string; label: Msg; summary: Msg };
  budget: {
    /** Month 0 of the baseline (of the scenario itself when there is no baseline). */
    now: BudgetSnapshot;
    /** The first month in which every new decision of the scenario has started. */
    after: BudgetSnapshot;
    /** The scenario 1, 5 and 10 years from now. */
    years: BudgetSnapshot[];
    /** `after.surplus − baseline surplus in the same month` (absent without a baseline). */
    surplusDelta?: number;
  };
  netWorth: HorizonPoint[];
  /** Lowest point of the bank cash during working life: median future and the weakest 10%. */
  cashLow: { median: CashPoint; p10: CashPoint; liquidMedian: CashPoint; baselineMedian?: CashPoint };
  /** Probability of a cash crunch (nothing left to sell) before the goal date, and within 1 / 5 / 10 years. */
  crunch: { beforeGoal: number; within: { years: number; prob: number }[]; baselineBeforeGoal?: number };
  goal: { label: Msg; target: number; month: number; prob: number; median: number; baselineProb?: number; deltaProb?: number };
  retirement?: {
    age: number;
    /** Gross pension per month at retirement and from the AHV reference age; spending per month in retirement. */
    incomeMonthly: number;
    incomeFromAhvAge: number;
    spendingMonthly: number;
    /** spending − income from the AHV age: what savings must cover each month. */
    gapMonthly: number;
    lastsTo90Prob: number;
    depletionAgeP10: number | null;
    baseline?: { incomeFromAhvAge: number; spendingMonthly: number; lastsTo90Prob: number };
  };
  decisions: DecisionOutlook[];
  markers: OutlookMarker[];
  /** Inputs the life-decision model needs from the user (no sourced default exists). */
  inputsNeeded: LifeInputNeeded[];
  /** Every parameter the decisions used, with value, unit and provenance. */
  params: LifeParamUsed[];
  /** The two simulations, for charts (bands) and anything not summarised here. */
  sim: SimResult;
  baselineSim?: SimResult;
}

export interface OutlookOptions {
  /** Scenario to compare with. Default: the profile's own plan (`baseScenario`). `null` = no comparison. */
  baseline?: Scenario | null;
  /** Behaviour parameters of the "real" twin, used for both simulations. */
  behavior?: BehaviorParams;
  /** Economic scenario for both simulations (default: the scenario's own, else baseline). */
  economy?: EconomyId | EconomyScenario;
  paths?: number;
  seed?: number;
  /** Month 0 for calendar dates when the profile has no `asOf` (default: today). Does not change any amount. */
  now?: Date;
}

/** Calendar position of a simulated month. */
type At = (month: number) => { month: number; year: number; ym: number; age: number };

const HORIZON_LABEL: Record<HorizonPoint["key"], Msg> = {
  y1: { key: "outlook.at.y1" },
  y5: { key: "outlook.at.y5" },
  y10: { key: "outlook.at.y10" },
  goal: { key: "outlook.at.goal" },
  retirement: { key: "outlook.at.retirement" },
};

const EVENT_MARKER: Record<LifeEvent["type"], Msg["key"]> = {
  house: "outlook.marker.house",
  child: "outlook.marker.child",
  jobloss: "outlook.marker.jobloss",
  crash: "outlook.marker.crash",
  raise: "outlook.marker.raise",
  expense: "outlook.marker.expense",
  income: "outlook.marker.income",
};

function snapshot(sim: SimResult, month: number, at: At): BudgetSnapshot {
  const d = sim.detail!;
  const m = Math.max(0, Math.min(d.months - 1, month));
  const items: BudgetItem[] = [];
  let income = 0;
  let expenses = 0;
  for (const l of d.lines) {
    const amount = l.monthly[m];
    if (amount === 0) continue;
    items.push({
      id: l.id,
      kind: l.kind,
      flow: l.flow,
      label: l.label,
      amount,
      ...(l.eventId ? { eventId: l.eventId } : {}),
      ...(l.provenance ? { provenance: l.provenance } : {}),
      ...(l.source ? { source: l.source } : {}),
      ...(l.estimate ? { estimate: true } : {}),
      ...(l.info ? { info: true } : {}),
      ...(l.prob !== undefined ? { prob: l.prob } : {}),
      ...(l.transfer ? { transfer: true } : {}),
    });
    if (l.info) continue;
    if (l.flow === "income") income += amount;
    else expenses += amount;
  }
  return { ...at(m), income, expenses, surplus: income - expenses, items };
}

function lowest(series: Float64Array, to: number, at: At): CashPoint {
  let month = 0;
  let amount = Infinity;
  for (let m = 0; m < Math.min(series.length, Math.max(1, to)); m++) {
    if (series[m] < amount) {
      amount = series[m];
      month = m;
    }
  }
  return { amount: Number.isFinite(amount) ? amount : 0, ...at(month) };
}

/** Constant stretches of a monthly series (amounts rounded to the franc). */
function phasesOf(monthly: Float64Array): { fromMonth: number; toMonth: number; monthly: number }[] {
  const out: { fromMonth: number; toMonth: number; monthly: number }[] = [];
  let from = 0;
  let cur = Math.round(monthly[0] ?? 0);
  for (let m = 1; m <= monthly.length; m++) {
    const v = m < monthly.length ? Math.round(monthly[m]) : NaN;
    if (v !== cur) {
      if (cur !== 0) out.push({ fromMonth: from, toMonth: m, monthly: cur });
      from = m;
      cur = v;
    }
  }
  return out;
}

function decisionsOf(sim: SimResult, events: readonly LifeEvent[], baselineIds: Set<string> | null, at: At): DecisionOutlook[] {
  const d = sim.detail!;
  const years = d.months / 12;
  const out: DecisionOutlook[] = [];
  for (const e of events) {
    const lines = d.lines.filter((l) => l.eventId === e.id);
    const oneOffs = d.oneOffs.filter((o) => o.eventId === e.id);
    if (!lines.length && !oneOffs.length && !e.decision) continue;
    const net = new Float64Array(years);
    // Every line of the decision counts here, also the `info` ones: a lower salary is the cost of working less.
    for (const l of lines) {
      if (l.transfer) continue;
      const sign = l.flow === "expense" ? 1 : -1;
      for (let m = 0; m < d.months; m++) net[Math.floor(m / 12)] += sign * l.monthly[m];
    }
    for (const o of oneOffs) if (!o.transfer) net[Math.floor(o.month / 12)] -= o.amount;
    const y0 = Math.min(years - 1, Math.max(0, Math.floor(e.month / 12)));
    const avg = (n: number) => {
      let s = 0;
      for (let y = y0; y < Math.min(years, y0 + n); y++) s += net[y];
      return s / (Math.min(years - y0, n) * 12);
    };
    let last = years - 1;
    while (last > y0 && net[last] === 0) last--;
    out.push({
      eventId: e.id,
      kind: e.decision?.kind ?? e.type,
      label: e.labelMsg ?? e.label,
      month: e.month,
      isNew: baselineIds ? !baselineIds.has(e.id) : false,
      lines: lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        flow: l.flow,
        label: l.label,
        eventId: e.id,
        ...(l.provenance ? { provenance: l.provenance } : {}),
        ...(l.source ? { source: l.source } : {}),
        ...(l.estimate ? { estimate: true } : {}),
        ...(l.info ? { info: true } : {}),
        ...(l.prob !== undefined ? { prob: l.prob } : {}),
        ...(l.transfer ? { transfer: true } : {}),
        phases: phasesOf(l.monthly),
        total: l.monthly.reduce((s, v) => s + v, 0),
      })),
      oneOffs: oneOffs.map((o) => ({ month: o.month, amount: o.amount, label: o.label, ...(o.transfer ? { transfer: true } : {}) })),
      byYear: Array.from({ length: last - y0 + 1 }, (_, i) => ({ year: at((y0 + i) * 12).year, age: at((y0 + i) * 12).age, net: net[y0 + i] })),
      netMonthly: { year1: avg(1), years5: avg(5), years10: avg(10) },
      totalNet: net.reduce((s, v) => s + v, 0),
    });
  }
  return out;
}

export function outlook(profile: Profile, scenario: Scenario, opts: OutlookOptions = {}): Outlook {
  const run = (s: Scenario) =>
    simulate({
      ...simInputFor(profile, s, opts.behavior),
      ...(opts.economy ? { economy: opts.economy } : {}),
      seed: opts.seed ?? HEADLINE.seed,
      paths: opts.paths ?? HEADLINE.paths,
      detail: true,
    });
  const sim = run(scenario);
  const base = opts.baseline === null ? null : (opts.baseline ?? baseScenario(profile));
  const baseSim = base ? run(base) : undefined;
  const d = sim.detail!;
  const age = sim.bands[0].age;
  // Month 0 on the calendar: the profile's as-of date (a dataset snapshot), else today.
  const start = profile.asOf ? new Date(`${profile.asOf.slice(0, 10)}T00:00:00Z`) : (opts.now ?? new Date());
  const startYear = profile.asOf ? start.getUTCFullYear() : start.getFullYear();
  const startMonth = profile.asOf ? start.getUTCMonth() : start.getMonth();
  const at: At = (month) => {
    const total = startMonth + month;
    const year = startYear + Math.floor(total / 12);
    return { month, year, ym: year * 100 + (total % 12) + 1, age: age + Math.floor(month / 12) };
  };
  const input = simInputFor(profile, scenario, opts.behavior);
  const p = input.profile;
  const economy = resolveEconomy(opts.economy ?? scenario.economy);

  // New decisions: events the baseline does not contain.
  const baselineIds = base ? new Set(base.events.map((e) => e.id)) : null;
  const fresh = scenario.events.filter((e) => (baselineIds ? !baselineIds.has(e.id) : true) && e.month < d.months);
  const afterMonth = Math.min(d.months - 1, fresh.reduce((m, e) => Math.max(m, e.month), 0));
  const now = snapshot(baseSim ?? sim, 0, at);
  const after = snapshot(sim, afterMonth, at);
  const years = [1, 5, 10].filter((y) => y * 12 < d.months).map((y) => snapshot(sim, y * 12, at));

  // Net worth at +1, +5, +10 years, at the goal date and at retirement (year ends of the cone).
  const band = (r: SimResult, y: number): YearBand | undefined => r.bands[y];
  const points: [HorizonPoint["key"], number][] = [
    ["y1", 1],
    ["y5", 5],
    ["y10", 10],
    ["goal", Math.round(sim.goalMonth / 12)],
    ["retirement", Math.max(0, p.retirementAge - age)],
  ];
  const netWorth: HorizonPoint[] = [];
  for (const [key, y] of points) {
    const b = band(sim, y);
    if (!b) continue;
    const bb = baseSim ? band(baseSim, y) : undefined;
    netWorth.push({
      key,
      label: HORIZON_LABEL[key],
      ...at(y * 12),
      p10: b.p10,
      p50: b.p50,
      p90: b.p90,
      ...(bb ? { baseline: { p10: bb.p10, p50: bb.p50, p90: bb.p90 }, deltaP50: b.p50 - bb.p50 } : {}),
    });
  }

  const workMonths = d.retireMonth > 0 ? Math.min(d.months, d.retireMonth) : d.months;
  const cashLow = {
    median: lowest(d.cash.p50, workMonths, at),
    p10: lowest(d.cash.p10, workMonths, at),
    liquidMedian: lowest(d.liquid.p50, workMonths, at),
    ...(baseSim?.detail ? { baselineMedian: lowest(baseSim.detail.cash.p50, workMonths, at) } : {}),
  };
  const within = [1, 5, 10]
    .filter((y) => y * 12 <= d.months)
    .map((y) => {
      let n = 0;
      for (let i = 0; i < d.crunchByMonth.length; i++) if (d.crunchByMonth[i] < y * 12) n++;
      return { years: y, prob: n / d.crunchByMonth.length };
    });

  const r = sim.retirement;
  const br = baseSim?.retirement;
  const retirement = r
    ? {
        age: r.age,
        incomeMonthly: r.monthlyIncomeAtRetirement,
        incomeFromAhvAge: r.monthlyIncomeFromAhvAge ?? r.monthlyIncomeAtRetirement,
        spendingMonthly: r.monthlySpending,
        gapMonthly: r.monthlySpending - (r.monthlyIncomeFromAhvAge ?? r.monthlyIncomeAtRetirement),
        lastsTo90Prob: r.lastsTo90Prob,
        depletionAgeP10: r.depletionAgeP10,
        ...(br ? { baseline: { incomeFromAhvAge: br.monthlyIncomeFromAhvAge ?? br.monthlyIncomeAtRetirement, spendingMonthly: br.monthlySpending, lastsTo90Prob: br.lastsTo90Prob } } : {}),
      }
    : undefined;

  // Chart markers: decisions and events, loan end, retirement, AHV, goals.
  const life = compileLife(p, scenario.events, d.months, d.retireMonth);
  const markers: OutlookMarker[] = life.markers.map((m) => ({ ...at(m.month), kind: m.kind, label: m.label, eventId: m.eventId, ...(m.amount !== undefined ? { amount: m.amount } : {}) }));
  for (const e of scenario.events) {
    if (e.decision || e.month < 0 || e.month >= d.months) continue;
    markers.push({ ...at(e.month), kind: e.type, label: e.labelMsg ?? e.label ?? { key: EVENT_MARKER[e.type] }, eventId: e.id, ...(e.amount ? { amount: e.amount } : {}) });
    const span = e.type === "child" ? (e.durationMonths ?? 216) : e.type === "jobloss" ? (e.durationMonths ?? 6) : 0;
    if (span && e.month + span < d.months) markers.push({ ...at(e.month + span), kind: `${e.type}End`, label: { key: e.type === "child" ? "outlook.marker.childEnd" : "outlook.marker.joblossEnd" }, eventId: e.id });
  }
  if (sim.debt?.debtFreeMonth && sim.debt.debtFreeMonth < d.months) markers.push({ ...at(sim.debt.debtFreeMonth), kind: "debtFree", label: { key: "outlook.marker.debtFree" } });
  if (d.retireMonth > 0 && d.retireMonth < d.months) markers.push({ ...at(d.retireMonth), kind: "retirement", label: { key: "outlook.marker.retirement" } });
  if (d.ahvMonth > 0 && d.ahvMonth !== d.retireMonth && d.ahvMonth < d.months) markers.push({ ...at(d.ahvMonth), kind: "ahv", label: { key: "outlook.marker.ahv" } });
  if (sim.goalMonth > 0 && sim.goalMonth < d.months) markers.push({ ...at(sim.goalMonth), kind: "goal", label: p.goal.label, amount: p.goal.target });
  for (const g of p.goals ?? []) {
    const month = Math.max(0, g.age - p.age) * 12;
    if (!g.primary && month > 0 && month < d.months) markers.push({ ...at(month), kind: "goal", label: g.label, amount: g.target });
  }
  markers.sort((a, b) => a.month - b.month);

  return {
    startYear,
    age,
    economy: { id: economy.id, label: economy.label, summary: economy.summary },
    budget: {
      now,
      after,
      years,
      ...(baseSim ? { surplusDelta: after.surplus - snapshot(baseSim, afterMonth, at).surplus } : {}),
    },
    netWorth,
    cashLow,
    crunch: { beforeGoal: sim.crunchProb, within, ...(baseSim ? { baselineBeforeGoal: baseSim.crunchProb } : {}) },
    goal: {
      label: p.goal.label,
      target: p.goal.target,
      month: sim.goalMonth,
      prob: sim.successProb,
      median: sim.medianAtGoal,
      ...(baseSim ? { baselineProb: baseSim.successProb, deltaProb: sim.successProb - baseSim.successProb } : {}),
    },
    ...(retirement ? { retirement } : {}),
    decisions: decisionsOf(sim, scenario.events, baselineIds, at),
    markers,
    inputsNeeded: life.inputsNeeded,
    params: life.params,
    sim,
    ...(baseSim ? { baselineSim: baseSim } : {}),
  };
}
