import type { EventType, LifeEvent, RecurringExpense, RiskProfile, Scenario, Transaction } from "@/lib/finance/types";
import { RISK_PROFILES, TRANSACTION_CATEGORIES } from "@/lib/finance/types";
import { payslipToIncome } from "@/lib/finance/pension";
import { receiptMoney } from "@/lib/format";
import type { Extraction } from "@/lib/snap/types";
import { categoryMsg, merchantText } from "@/lib/data/merchants";
import { msg, type Locale, type Msg, type Text } from "@/lib/i18n/types";
import { orderedParsers } from "./intents";
import { eventLabel } from "./intents/shared";

export type SetKey = "retirementAge" | "riskProfile" | "contributes3a" | "monthlyInvest" | "expenseDelta" | "optimize";

/**
 * Shared contract with the LLM gateway (`/api/twin`, task "command"):
 *  add / shift / remove → life events
 *  set → scenario knobs: retirementAge (55–70), riskProfile (conservative|balanced|growth),
 *        contributes3a (bool), monthlyInvest (extra CHF/month invested), expenseDelta (CHF/month change,
 *        negative = cut — applied on top of the current plan), optimize (bool: invest idle cash + max 3a)
 */
export type Op =
  | { op: "add"; type: EventType; label: string; labelMsg?: Msg; month: number; amount: number; duration?: number }
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
  return normalizeOps(raw, events);
}

/** Validate built-in ops while retaining their trusted display labels. */
export function validateLocalOps(ops: Op[], events: LifeEvent[]): Op[] {
  return normalizeOps(ops, events, true);
}

function normalizeOps(raw: unknown, events: LifeEvent[], local = false): Op[] {
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
      const labelMsg = local ? (o as Extract<Op, { op: "add" }>).labelMsg : undefined;
      out.push({ op: "add", type, label, ...(labelMsg && { labelMsg }), month: Math.round(month!), amount: amount ?? 0, duration: duration ?? undefined });
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
        ...(o.labelMsg && { labelMsg: o.labelMsg }),
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

export function localParseCommand(
  text: string,
  events: LifeEvent[],
  now = new Date(),
  locale: Locale = "en",
  retirementAge = 65,
): Op[] | null {
  const context = { text, events, now, retirementAge, house: events.find((event) => event.type === "house") };
  for (const parser of orderedParsers(locale)) {
    const valid = validateLocalOps(parser.parse(context), events);
    if (valid.length > 0) return valid;
  }
  return null;
}

/** Short descriptions for the command bar, rendered in the active locale. */
export function describeOps(ops: Op[]): Msg[] {
  return ops.map((o) => {
    if (o.op === "add") return msg("ops.add", { label: o.labelMsg ?? o.label });
    if (o.op === "shift") return msg("ops.shift", { months: o.months });
    if (o.op === "remove") return msg("ops.remove");
    switch (o.key) {
      case "riskProfile":
        return msg("ops.riskProfile", { value: msg(`risk.${o.value as RiskProfile}`) });
      case "contributes3a":
        return msg(o.value ? "ops.contributes3aOn" : "ops.contributes3aOff");
      case "optimize":
        return msg(o.value ? "ops.optimizeOn" : "ops.optimizeOff");
      default:
        return msg(`ops.${o.key}`, { value: Number(o.value) });
    }
  });
}

// ---------------------------------------------------------------------------
// Snap → twin: deterministic mapping from an extraction to a twin update.
// ---------------------------------------------------------------------------

export type TwinUpdate =
  | { kind: "event"; ops: Op[]; summary: Msg }
  | { kind: "transaction"; tx: Transaction; summary: Msg }
  /** A recurring bill (premium, subscription…) that is not yet in the budget → raises monthly expenses. */
  | { kind: "recurring"; expense: RecurringExpense; tx: Transaction; summary: Msg }
  /**
   * Payslip. `netIncomeMonth` is take-home after income tax (12 months), derived from the payslip's
   * Nettolohn (before tax) with `payslipToIncome`; `grossIncomeYear` drives BVG and the bank test.
   */
  | { kind: "income"; netIncomeMonth: number; grossIncomeYear: number; payslipNet: number; summary: Msg }
  | { kind: "none"; summary: Msg };

export interface UpdateContext {
  /** Profile transactions — used to detect bills that are already part of the budget. */
  transactions?: Transaction[];
  /** Recurring costs already added in this scenario. */
  recurring?: RecurringExpense[];
  marginalTaxRate?: number;
  /** The profile's calibrated income — a payslip is applied as a change against it (marginal tax). */
  income?: { grossIncomeYear: number; netIncomeMonth: number };
}


const RECURRING_HINT = /pr[äa]mie|praemie|premium|prime|cotisation|monat|monthly|mensuel|abo\b|abonnement|subscription|leasing|miete|loyer|rent\b|rate\b|quartal|quarter|trimest|jahres|annual|annuel|yearly/i;

function monthlyFromBill(amount: number, text: string): number {
  if (/quartal|quarter|trimest/i.test(text)) return amount / 3;
  if (/jahres|annual|annuel|yearly|\bjahr\b|\bp\.a\./i.test(text)) return amount / 12;
  return amount;
}

/** Is this monthly amount already in the budget (same category, recurring in the history, ±5%)? */
function alreadyBudgeted(monthly: number, category: Transaction["category"], ctx: UpdateContext): Text | null {
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
    if (v.months.size >= 2 && Math.abs(avg - monthly) <= monthly * 0.05) return msg("summary.duplicateOf", { merchant: merchantText(merchant), amount: avg });
  }
  return null;
}

export function extractionToUpdate(e: Extraction, events: LifeEvent[], now = new Date(), ctx: UpdateContext = {}): TwinUpdate {
  if (e.vision?.kind === "chart") {
    return { kind: "none", summary: e.vision.chart.headline };
  }
  const amount = Number(e.amount) || 0;
  switch (e.kind) {
    case "listing": {
      if (!amount) return { kind: "none", summary: msg("summary.listingNoPrice") };
      if (amount < BOUNDS.housePrice[0] || amount > BOUNDS.housePrice[1])
        return { kind: "none", summary: msg("summary.listingImplausible", { amount }) };
      const house = events.find((x) => x.type === "house");
      const baseLabel = e.rooms
        ? e.location ? msg("event.roomsHomeIn", { rooms: e.rooms, place: e.location }) : msg("event.roomsHome", { rooms: e.rooms })
        : e.location ? msg("event.listingHomeIn", { place: e.location }) : msg("event.listingHome");
      const label = e.areaM2 ? msg("common.separator", { first: baseLabel, second: `${Math.round(e.areaM2)} m²` }) : baseLabel;
      return {
        kind: "event",
        ops: [{ op: "add", type: "house", ...eventLabel(label), month: house?.month ?? 24, amount }],
        summary: house ? msg("summary.listingReplaces", { label, amount, old: house.labelMsg ?? house.label })
          : msg("summary.listingAdded", { label, amount }),
      };
    }
    case "receipt":
    case "bill": {
      if (!amount) return { kind: "none", summary: msg("summary.noTotal") };
      // "other" is the importers' review-needed category; a snapped receipt keeps its "shopping" fallback.
      const categories: readonly string[] = e.kind === "receipt" ? TRANSACTION_CATEGORIES.filter((c) => c !== "other")
        : ["groceries", "dining", "transport", "shopping", "insurance", "bills", "travel"];
      const cat = (categories.includes(e.category ?? "")
        ? e.category
        : e.kind === "bill" ? "bills" : "shopping") as Transaction["category"];
      const tx: Transaction = { date: e.date ?? now.toISOString().slice(0, 10), merchant: e.merchant ?? "Unknown", category: cat,
        amount, note: e.label, ...(e.kind === "receipt" && e.items?.length ? { items: e.items } : {}) };
      const text = `${e.message ?? ""} ${e.label ?? ""}`;
      if (e.kind === "bill" && (RECURRING_HINT.test(text) || cat === "insurance")) {
        const monthly = Math.round(monthlyFromBill(amount, text));
        const merchant = e.merchant ?? msg("summary.bill");
        const dup = alreadyBudgeted(monthly, cat, ctx);
        if (dup) {
          return { kind: "none", summary: msg("summary.billDuplicate", { merchant, monthly, match: dup }) };
        }
        return {
          kind: "recurring",
          expense: { id: `rc-${Date.now().toString(36)}-${counter++}`, label: e.labelMsg ?? (e.label || e.merchant || msg("summary.recurringBill")), monthly, source: "snap" },
          tx,
          summary: msg("summary.billRecurring", { merchant, monthly }),
        };
      }
      return {
        kind: "transaction",
        tx,
        summary: e.kind === "receipt"
          ? msg("receipt.recorded", { merchant: e.merchant ?? msg("summary.spend"), amount: receiptMoney(amount), category: categoryMsg(cat) })
          : msg("summary.receipt", { merchant: e.merchant ?? msg("summary.spend"), amount, category: categoryMsg(cat) }),
      };
    }
    case "payslip": {
      if (!amount) return { kind: "none", summary: msg("summary.payslipNoNet") };
      if (amount < 1000 || amount > 60_000) return { kind: "none", summary: msg("summary.payslipImplausible", { amount }) };
      const inc = payslipToIncome(amount, ctx.marginalTaxRate ?? 0.25, ctx.income);
      return {
        kind: "income",
        payslipNet: amount,
        netIncomeMonth: inc.netIncomeMonth,
        grossIncomeYear: inc.grossIncomeYear,
        summary: msg("summary.payslip", { net: amount, gross: inc.grossIncomeYear, takeHome: inc.netIncomeMonth }),
      };
    }
    case "note": {
      if (!amount) return { kind: "none", summary: msg("summary.noteNoAmount", { label: e.labelMsg ?? e.label ?? msg("summary.note") }) };
      if (amount > BOUNDS.oneOff[1]) return { kind: "none", summary: msg("summary.noteImplausible", { amount }) };
      const month = e.year ? Math.min(BOUNDS.month[1], Math.max(0, (e.year - now.getFullYear()) * 12 + (6 - now.getMonth()))) : 24;
      const label = e.labelMsg ?? e.label ?? msg("event.goalFromNote");
      return {
        kind: "event",
        ops: [{ op: "add", type: "expense", ...(typeof label === "string" ? { label } : eventLabel(label)), month, amount }],
        summary: e.year ? msg("summary.noteAddedYear", { label, amount, year: e.year }) : msg("summary.noteAdded", { label, amount }),
      };
    }
    default:
      return { kind: "none", summary: msg("summary.nothing") };
  }
}
