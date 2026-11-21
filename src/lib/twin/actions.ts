import type { EventType, LifeEvent, RecurringExpense, RiskProfile, Scenario, Transaction } from "@/lib/finance/types";
import { RISK_PROFILES } from "@/lib/finance/types";
import { payslipToIncome } from "@/lib/finance/pension";
import type { Extraction } from "@/lib/snap/types";
import { groupCh } from "@/lib/format";

export type SetKey = "retirementAge" | "riskProfile" | "contributes3a" | "monthlyInvest" | "expenseDelta" | "optimize";

/**
 * Shared contract with the LLM gateway (`/api/twin`, task "command"):
 *  add / shift / remove → life events
 *  set → scenario knobs: retirementAge (55–70), riskProfile (conservative|balanced|growth),
 *        contributes3a (bool), monthlyInvest (extra CHF/month invested), expenseDelta (CHF/month change,
 *        negative = cut — applied on top of the current plan), optimize (bool: invest idle cash + max 3a)
 */
export type Op =
  | { op: "add"; type: EventType; label: string; month: number; amount: number; duration?: number }
  | { op: "shift"; id: string; months: number }
  | { op: "remove"; id: string }
  | { op: "set"; key: SetKey; value: number | string | boolean };

const EVENT_TYPES: EventType[] = ["house", "child", "jobloss", "crash", "raise", "expense", "income"];
const SET_KEYS: SetKey[] = ["retirementAge", "riskProfile", "contributes3a", "monthlyInvest", "expenseDelta", "optimize"];

/** Sane bounds for every op. Anything outside is dropped, never clamped silently into a different meaning. */
export const BOUNDS = {
  month: [0, 480],
  shift: [-480, 480],
  housePrice: [50_000, 20_000_000],
  childMonthly: [0, 10_000],
  raise: [-200_000, 500_000],
  oneOff: [1, 20_000_000],
  duration: [1, 480],
  retirementAge: [55, 70],
  monthlyInvest: [0, 50_000],
  expenseDelta: [-20_000, 20_000],
} as const;

let counter = 0;
const newId = () => `ev-${Date.now().toString(36)}-${counter++}`;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/['’\s]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const within = (v: number | null, [lo, hi]: readonly [number, number]) => v !== null && v >= lo && v <= hi;
const bool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : v === "true" || v === 1 || v === "1" ? true : v === "false" || v === 0 || v === "0" ? false : null;

/**
 * Validates untrusted ops (from the LLM or the local parser) against the current events.
 * Invalid ops are dropped; valid ones are normalised (rounded months, coerced numbers/booleans).
 */
export function validateOps(raw: unknown, events: LifeEvent[]): Op[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(events.map((e) => e.id));
  const out: Op[] = [];
  for (const o of raw as Record<string, unknown>[]) {
    if (!o || typeof o !== "object") continue;
    if (o.op === "add") {
      const type = o.type as EventType;
      if (!EVENT_TYPES.includes(type)) continue;
      const month = num(o.month ?? 12);
      if (!within(month, BOUNDS.month)) continue;
      let amount = num(o.amount ?? 0);
      let duration = o.duration === undefined || o.duration === null ? undefined : num(o.duration);
      if (duration !== undefined && !within(duration, BOUNDS.duration)) continue;
      if (type === "house" && !within(amount, BOUNDS.housePrice)) continue;
      if (type === "child") {
        if (!amount) amount = 1500;
        if (!within(amount, BOUNDS.childMonthly)) continue;
        duration = duration ?? 216;
      }
      if (type === "jobloss") {
        amount = 0;
        duration = duration ?? 6;
      }
      if (type === "crash") amount = 0;
      if (type === "raise" && (!within(amount, BOUNDS.raise) || amount === 0)) continue;
      if ((type === "expense" || type === "income") && !within(amount, BOUNDS.oneOff)) continue;
      const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 60) : type;
      out.push({ op: "add", type, label, month: Math.round(month!), amount: amount ?? 0, duration: duration ?? undefined });
    } else if (o.op === "shift") {
      const months = num(o.months);
      if (typeof o.id !== "string" || !ids.has(o.id) || !within(months, BOUNDS.shift) || Math.round(months!) === 0) continue;
      out.push({ op: "shift", id: o.id, months: Math.round(months!) });
    } else if (o.op === "remove") {
      if (typeof o.id !== "string" || !ids.has(o.id)) continue;
      out.push({ op: "remove", id: o.id });
    } else if (o.op === "set") {
      const key = o.key as SetKey;
      if (!SET_KEYS.includes(key)) continue;
      if (key === "riskProfile") {
        const v = String(o.value).toLowerCase() as RiskProfile;
        if (RISK_PROFILES.includes(v)) out.push({ op: "set", key, value: v });
      } else if (key === "contributes3a" || key === "optimize") {
        const v = bool(o.value);
        if (v !== null) out.push({ op: "set", key, value: v });
      } else {
        const v = num(o.value);
        if (within(v, BOUNDS[key])) out.push({ op: "set", key, value: Math.round(v!) });
      }
    }
  }
  return out;
}

/** Applies the event ops (add/shift/remove). `set` ops are scenario-level — see applyScenarioOps. */
export function applyOps(events: LifeEvent[], ops: Op[], source: LifeEvent["source"] = "command"): LifeEvent[] {
  let out = [...events];
  for (const o of ops) {
    if (o.op === "add") {
      if (o.type === "house") out = out.filter((e) => e.type !== "house"); // one home at a time
      out.push({
        id: newId(),
        type: o.type,
        label: o.label || o.type,
        month: Math.max(0, Math.round(o.month ?? 12)),
        amount: Math.max(o.type === "raise" ? -Infinity : 0, Number(o.amount) || 0),
        durationMonths: o.duration,
        source,
      });
    } else if (o.op === "shift") {
      out = out.map((e) => (e.id === o.id ? { ...e, month: Math.max(0, e.month + Math.round(o.months)) } : e));
    } else if (o.op === "remove") {
      out = out.filter((e) => e.id !== o.id);
    }
  }
  return out;
}

/** Applies every op (events + `set` knobs) to a scenario. Pure. */
export function applyScenarioOps(s: Scenario, ops: Op[], source: LifeEvent["source"] = "command"): Scenario {
  let next: Scenario = { ...s, events: applyOps(s.events, ops, source) };
  for (const o of ops) {
    if (o.op !== "set") continue;
    switch (o.key) {
      case "retirementAge":
        next = { ...next, retirementAge: Number(o.value) };
        break;
      case "riskProfile":
        next = { ...next, riskProfile: o.value as RiskProfile };
        break;
      case "contributes3a":
        next = { ...next, contributes3a: Boolean(o.value) };
        break;
      case "monthlyInvest":
        next = { ...next, monthlyInvest: Number(o.value) };
        break;
      case "expenseDelta":
        next = { ...next, expenseDelta: clamp(next.expenseDelta + Number(o.value), BOUNDS.expenseDelta) };
        break;
      case "optimize":
        next = { ...next, optimize: Boolean(o.value) };
        break;
    }
  }
  return next;
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));

/** Compact event list for the LLM prompt: "ev-house:Flat in Winterthur@24". */
export function compactEvents(events: LifeEvent[]): string {
  return events.map((e) => `${e.id}:${e.label}@${e.month}`).join("; ");
}

// ---------------------------------------------------------------------------
// Local intent parser — the zero-token path for common what-ifs.
// Only when it can't parse the sentence do we pay for an LLM call.
// ---------------------------------------------------------------------------

const NUM = String.raw`(\d+(?:[.,']\d+)*)\s*(k|mio|million|thousand|m)?\b`;

function money(n: string, unit?: string): number {
  const v = Number(n.replace(/['’]/g, "").replace(",", "."));
  const u = (unit ?? "").toLowerCase();
  if (u === "k" || u === "thousand") return v * 1000;
  if (u === "m" || u === "mio" || u === "million") return v * 1_000_000;
  return v;
}

function monthFrom(text: string, nowYear: number, nowMonth: number): number | undefined {
  const y = text.match(/\b(20[2-6]\d)\b/);
  if (y) return Math.max(0, (Number(y[1]) - nowYear) * 12 + (6 - nowMonth));
  const inYears = text.match(/in\s+(\d+)\s+years?/i);
  if (inYears) return Number(inYears[1]) * 12;
  const inMonths = text.match(/in\s+(\d+)\s+months?/i);
  if (inMonths) return Number(inMonths[1]);
  if (/next year/i.test(text)) return 12;
  return undefined;
}

const PER_MONTH = String.raw`(?:a|per|each|every|\/|in\s+a)\s*month|monthly|\/\s*mo\b|p\.?\s?m\.?`;

export function localParseCommand(text: string, events: LifeEvent[], now = new Date()): Op[] | null {
  const t = text.toLowerCase().replace(/chf\s*/g, "").replace(/(\d)['’](\d)/g, "$1$2");
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  const when = monthFrom(t, nowYear, nowMonth);
  const ops: Op[] = [];
  const house = events.find((e) => e.type === "house");

  // retire at 60 / retire early at 62
  const retire = t.match(/retir\w*\s+(?:early\s+)?(?:at|by|when\s+i(?:'|’)?m)\s+(?:age\s+)?(\d{2})\b/);
  if (retire) ops.push({ op: "set", key: "retirementAge", value: Number(retire[1]) });

  // start investing 500 a month / invest 500 per month
  const invest = t.match(new RegExp(String.raw`invest\w*\s+(?:an?\s+extra\s+)?${NUM}\s*(?:${PER_MONTH})`));
  if (invest) ops.push({ op: "set", key: "monthlyInvest", value: money(invest[1], invest[2]) });
  else if (/(invest|put)\s+(my\s+|the\s+)?(idle\s+)?cash\s+(to\s+work|in)|invest\s+(my\s+|the\s+)?idle/.test(t))
    ops.push({ op: "set", key: "optimize", value: true });

  // switch to growth / go conservative / more aggressive
  const risk = t.match(/\b(switch|change|move|go|be|invest|rebalance|make\s+it|more)\b[^.]{0,25}?\b(conservative|defensive|safer|balanced|growth|aggressive)\b/);
  if (risk) {
    const w = risk[2];
    const value: RiskProfile = w === "balanced" ? "balanced" : w === "growth" || w === "aggressive" ? "growth" : "conservative";
    ops.push({ op: "set", key: "riskProfile", value });
  }

  // cut spending by 400 / spend 400 less / reduce expenses by 400
  const cut =
    t.match(new RegExp(String.raw`(?:cut|reduce|lower|trim|save)\s+(?:my\s+)?(?:spending|expenses|costs|budget)?\s*(?:by\s+)?${NUM}`)) ??
    t.match(new RegExp(String.raw`spend\s+${NUM}\s+less`));
  const more = t.match(new RegExp(String.raw`spend\s+${NUM}\s+more`));
  if (cut) ops.push({ op: "set", key: "expenseDelta", value: -money(cut[1], cut[2]) });
  else if (more) ops.push({ op: "set", key: "expenseDelta", value: money(more[1], more[2]) });

  // max out 3a / start 3a / stop 3a
  if (/\b3a\b/.test(t) || /pillar\s*3/.test(t)) {
    if (/(stop|pause|quit|no longer)\b[^.]{0,20}(3a|pillar)/.test(t)) ops.push({ op: "set", key: "contributes3a", value: false });
    else if (/(max|start|open|begin|pay\s+into|contribute|use)/.test(t)) ops.push({ op: "set", key: "contributes3a", value: true });
  }

  // delay / postpone the house
  const delay = t.match(/(delay|postpone|push|wait)\D{0,30}?(\d+)\s*(years?|months?)/);
  if (delay && house) {
    const n = Number(delay[2]) * (delay[3].startsWith("year") ? 12 : 1);
    ops.push({ op: "shift", id: house.id, months: n });
  }

  // buy a house/flat for X
  const buy = t.match(new RegExp(String.raw`(buy|purchase)\b[^\d]{0,40}?${NUM}`));
  if (buy && /(house|home|flat|apartment|condo)/.test(t)) {
    const price = money(buy[2], buy[3]);
    if (price > 50_000) {
      const where = text.match(/\bin\s+([A-ZÄÖÜ][\wäöüé-]+)/);
      ops.push({ op: "add", type: "house", label: `Home${where ? " in " + where[1] : ""}`, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // job loss
  const job = t.match(/(lose|lost|losing)\s+(my\s+)?job|unemploy|laid off/);
  if (job) {
    const dur = t.match(/(\d+)\s*months?/);
    ops.push({ op: "add", type: "jobloss", label: "Job loss", month: when ?? 12, amount: 0, duration: dur ? Number(dur[1]) : 6 });
  }

  // market crash
  if (/crash|market\s+(drops?|falls?|tanks?)|recession/.test(t)) {
    ops.push({ op: "add", type: "crash", label: "Market crash −30%", month: when ?? 12, amount: 0 });
  }

  // child
  if (/\b(baby|child|kid)\b/.test(t)) {
    ops.push({ op: "add", type: "child", label: "Baby", month: when ?? 18, amount: 1500, duration: 216 });
  }

  // raise
  const raise = t.match(new RegExp(String.raw`(raise|promotion|salary increase)[^\d]{0,20}${NUM}`));
  if (raise) {
    ops.push({ op: "add", type: "raise", label: "Raise", month: when ?? 6, amount: money(raise[2], raise[3]) });
  }

  const valid = validateOps(ops, events);
  return valid.length > 0 ? valid : null;
}

/** Short human description of ops, e.g. for the command bar. */
export function describeOps(ops: Op[]): string {
  return ops
    .map((o) => {
      if (o.op === "add") return `+ ${o.label}`;
      if (o.op === "shift") return `shift ${o.months > 0 ? "+" : ""}${o.months} mo`;
      if (o.op === "remove") return "remove event";
      return `${o.key} → ${String(o.value)}`;
    })
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Snap → twin: deterministic mapping from an extraction to a twin update.
// ---------------------------------------------------------------------------

export type TwinUpdate =
  | { kind: "event"; ops: Op[]; summary: string }
  | { kind: "transaction"; tx: Transaction; summary: string }
  /** A recurring bill (premium, subscription…) that is not yet in the budget → raises monthly expenses. */
  | { kind: "recurring"; expense: RecurringExpense; tx: Transaction; summary: string }
  /**
   * Payslip. `netIncomeMonth` is take-home after income tax (12 months), derived from the payslip's
   * Nettolohn (before tax) with `payslipToIncome`; `grossIncomeYear` drives BVG and the bank test.
   */
  | { kind: "income"; netIncomeMonth: number; grossIncomeYear: number; payslipNet: number; summary: string }
  | { kind: "none"; summary: string };

export interface UpdateContext {
  /** Profile transactions — used to detect bills that are already part of the budget. */
  transactions?: Transaction[];
  /** Recurring costs already added in this scenario. */
  recurring?: RecurringExpense[];
  marginalTaxRate?: number;
  /** The profile's calibrated income — a payslip is applied as a change against it (marginal tax). */
  income?: { grossIncomeYear: number; netIncomeMonth: number };
}

const chf = (n: number) => `CHF ${groupCh(Math.round(n))}`;

const RECURRING_HINT = /pr[äa]mie|praemie|premium|prime|cotisation|monat|monthly|mensuel|abo\b|abonnement|subscription|leasing|miete|loyer|rent\b|rate\b|quartal|quarter|trimest|jahres|annual|annuel|yearly/i;

function monthlyFromBill(amount: number, text: string): number {
  if (/quartal|quarter|trimest/i.test(text)) return amount / 3;
  if (/jahres|annual|annuel|yearly|\bjahr\b|\bp\.a\./i.test(text)) return amount / 12;
  return amount;
}

/** Is this monthly amount already in the budget (same category, recurring in the history, ±5%)? */
function alreadyBudgeted(monthly: number, category: Transaction["category"], ctx: UpdateContext): string | null {
  const inScenario = ctx.recurring?.find((r) => Math.abs(r.monthly - monthly) <= monthly * 0.05);
  if (inScenario) return inScenario.label;
  const byMerchant = new Map<string, { months: Set<string>; total: number }>();
  for (const t of ctx.transactions ?? []) {
    if (t.category !== category) continue;
    const m = byMerchant.get(t.merchant) ?? { months: new Set(), total: 0 };
    m.months.add(t.date.slice(0, 7));
    m.total += t.amount;
    byMerchant.set(t.merchant, m);
  }
  for (const [merchant, v] of byMerchant) {
    const avg = v.total / v.months.size;
    if (v.months.size >= 2 && Math.abs(avg - monthly) <= monthly * 0.05) return `${merchant} (${chf(avg)}/mo)`;
  }
  return null;
}

export function extractionToUpdate(e: Extraction, events: LifeEvent[], now = new Date(), ctx: UpdateContext = {}): TwinUpdate {
  const amount = Number(e.amount) || 0;
  switch (e.kind) {
    case "listing": {
      if (!amount) return { kind: "none", summary: "Listing found, but no price could be read." };
      if (amount < BOUNDS.housePrice[0] || amount > BOUNDS.housePrice[1])
        return { kind: "none", summary: `Listing price ${chf(amount)} looks implausible — not added.` };
      const house = events.find((x) => x.type === "house");
      const label = `${e.rooms ? e.rooms + "-room " : ""}home${e.location ? " in " + e.location : ""}`;
      return {
        kind: "event",
        ops: [{ op: "add", type: "house", label, month: house?.month ?? 24, amount }],
        summary: `🏠 ${label} · ${chf(amount)} → placed on your timeline${house ? ` (replaces “${house.label}”)` : ""}`,
      };
    }
    case "receipt":
    case "bill": {
      if (!amount) return { kind: "none", summary: "Couldn't read a total." };
      const cat = (["groceries", "dining", "transport", "shopping", "insurance", "bills", "travel"].includes(e.category ?? "")
        ? e.category
        : e.kind === "bill" ? "bills" : "shopping") as Transaction["category"];
      const tx: Transaction = { date: e.date ?? now.toISOString().slice(0, 10), merchant: e.merchant ?? "Unknown", category: cat, amount, note: e.label };
      const text = `${e.message ?? ""} ${e.label ?? ""}`;
      if (e.kind === "bill" && (RECURRING_HINT.test(text) || cat === "insurance")) {
        const monthly = Math.round(monthlyFromBill(amount, text));
        const dup = alreadyBudgeted(monthly, cat, ctx);
        if (dup) {
          return { kind: "none", summary: `🧾 ${e.merchant ?? "Bill"} · ${chf(monthly)}/month · matches ${dup} → already in your budget, nothing changes` };
        }
        return {
          kind: "recurring",
          expense: { id: `rc-${Date.now().toString(36)}-${counter++}`, label: e.label || e.merchant || "Recurring bill", monthly, source: "snap" },
          tx,
          summary: `🧾 ${e.merchant ?? "Bill"} · ${chf(monthly)}/month recurring → added to your monthly costs`,
        };
      }
      return {
        kind: "transaction",
        tx,
        summary: `🧾 ${e.merchant ?? "Spend"} · ${chf(amount)} · ${cat} → counted in this month's spending`,
      };
    }
    case "payslip": {
      if (!amount) return { kind: "none", summary: "Payslip found, but no net pay." };
      if (amount < 1000 || amount > 60_000) return { kind: "none", summary: `Net pay ${chf(amount)} looks implausible — not used.` };
      const inc = payslipToIncome(amount, ctx.marginalTaxRate ?? 0.25, ctx.income);
      return {
        kind: "income",
        payslipNet: amount,
        netIncomeMonth: inc.netIncomeMonth,
        grossIncomeYear: inc.grossIncomeYear,
        summary: `💼 Nettolohn ${chf(amount)} ×13 → gross ≈ ${chf(inc.grossIncomeYear)}/yr, take-home after tax ≈ ${chf(inc.netIncomeMonth)}/month`,
      };
    }
    case "note": {
      if (!amount) return { kind: "none", summary: `✍️ “${e.label ?? "Note"}” — no amount found.` };
      if (amount > BOUNDS.oneOff[1]) return { kind: "none", summary: `✍️ Amount ${chf(amount)} looks implausible — not added.` };
      const month = e.year ? Math.min(BOUNDS.month[1], Math.max(0, (e.year - now.getFullYear()) * 12 + (6 - now.getMonth()))) : 24;
      const label = e.label ?? "Goal from note";
      return {
        kind: "event",
        ops: [{ op: "add", type: "expense", label, month, amount }],
        summary: `✍️ ${label} · ${chf(amount)}${e.year ? " in " + e.year : ""} → added as a planned expense`,
      };
    }
    default:
      return { kind: "none", summary: "Nothing financial found in this image." };
  }
}
