/**
 * English what-if patterns — moved unchanged from the original `localParseCommand`.
 * Only the event labels gained a translatable `labelMsg` (the English `label` is identical).
 */
import type { RiskProfile } from "@/lib/finance/types";
import type { Op } from "../actions";
import { eventLabel, type IntentContext, type IntentParser } from "./shared";

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

function parse({ text, house, now }: IntentContext): Op[] {
  const t = text.toLowerCase().replace(/chf\s*/g, "").replace(/(\d)['’](\d)/g, "$1$2");
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  const when = monthFrom(t, nowYear, nowMonth);
  const ops: Op[] = [];

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
      const label = eventLabel(where ? { key: "event.homeIn", params: { place: where[1] } } : { key: "event.home" });
      ops.push({ op: "add", type: "house", ...label, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // job loss
  const job = t.match(/(lose|lost|losing)\s+(my\s+)?job|unemploy|laid off/);
  if (job) {
    const dur = t.match(/(\d+)\s*months?/);
    ops.push({ op: "add", type: "jobloss", ...eventLabel({ key: "event.jobLoss" }), month: when ?? 12, amount: 0, duration: dur ? Number(dur[1]) : 6 });
  }

  // market crash
  if (/crash|market\s+(drops?|falls?|tanks?)|recession/.test(t)) {
    ops.push({ op: "add", type: "crash", ...eventLabel({ key: "event.crash" }), month: when ?? 12, amount: 0 });
  }

  // child
  if (/\b(baby|child|kid)\b/.test(t)) {
    ops.push({ op: "add", type: "child", ...eventLabel({ key: "event.baby" }), month: when ?? 18, amount: 1500, duration: 216 });
  }

  // raise
  const raise = t.match(new RegExp(String.raw`(raise|promotion|salary increase)[^\d]{0,20}${NUM}`));
  if (raise) {
    ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount: money(raise[2], raise[3]) });
  }

  return ops;
}

export const englishIntents: IntentParser = { locale: "en", parse };
