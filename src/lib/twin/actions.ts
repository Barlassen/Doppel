import type { EventType, LifeEvent, Transaction } from "@/lib/finance/types";
import type { Extraction } from "@/lib/snap/types";

export type Op =
  | { op: "add"; type: EventType; label: string; month: number; amount: number; duration?: number }
  | { op: "shift"; id: string; months: number }
  | { op: "remove"; id: string };

let counter = 0;
const newId = () => `ev-${Date.now().toString(36)}-${counter++}`;

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
        amount: Math.max(0, Number(o.amount) || 0),
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

/** Compact event list for the LLM prompt: "ev-house:Flat in Winterthur@24". */
export function compactEvents(events: LifeEvent[]): string {
  return events.map((e) => `${e.id}:${e.label}@${e.month}`).join("; ");
}

// ---------------------------------------------------------------------------
// Local intent parser — the zero-token path for common what-ifs.
// Only when it can't parse the sentence do we pay for an LLM call.
// ---------------------------------------------------------------------------

const NUM = String.raw`(\d+(?:[.,']\d+)*)\s*(k|m|mio|million|thousand)?`;

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

export function localParseCommand(text: string, events: LifeEvent[], now = new Date()): Op[] | null {
  const t = text.toLowerCase();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  const when = monthFrom(t, nowYear, nowMonth);
  const ops: Op[] = [];
  const house = events.find((e) => e.type === "house");

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

  return ops.length > 0 ? ops : null;
}

// ---------------------------------------------------------------------------
// Snap → twin: deterministic mapping from an extraction to a twin update.
// ---------------------------------------------------------------------------

export type TwinUpdate =
  | { kind: "event"; ops: Op[]; summary: string }
  | { kind: "transaction"; tx: Transaction; summary: string }
  | { kind: "income"; netIncomeMonth: number; summary: string }
  | { kind: "none"; summary: string };

const chf = (n: number) => `CHF ${Math.round(n).toLocaleString("de-CH")}`;

export function extractionToUpdate(e: Extraction, events: LifeEvent[], now = new Date()): TwinUpdate {
  const amount = Number(e.amount) || 0;
  switch (e.kind) {
    case "listing": {
      if (!amount) return { kind: "none", summary: "Listing found, but no price could be read." };
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
      return {
        kind: "transaction",
        tx: { date: e.date ?? now.toISOString().slice(0, 10), merchant: e.merchant ?? "Unknown", category: cat, amount, note: e.label },
        summary: `🧾 ${e.merchant ?? "Spend"} · ${chf(amount)} · ${cat} → added to your behavioural twin`,
      };
    }
    case "payslip":
      if (!amount) return { kind: "none", summary: "Payslip found, but no net pay." };
      return { kind: "income", netIncomeMonth: amount, summary: `💼 Net pay ${chf(amount)}/month → income updated` };
    case "note": {
      if (!amount) return { kind: "none", summary: `✍️ “${e.label ?? "Note"}” — no amount found.` };
      const month = e.year ? Math.max(0, (e.year - now.getFullYear()) * 12 + (6 - now.getMonth())) : 24;
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
