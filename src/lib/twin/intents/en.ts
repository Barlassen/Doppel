/**
 * English what-if patterns (0 tokens).
 *
 * Numbers go through the shared normaliser first, so "1'200", "1,200", "1,200,000", "1.200.000", "850,000",
 * "1.2M" and "900k" all read as one amount. A bare year (2020–2069) is never taken as a price.
 */
import type { RiskProfile } from "@/lib/finance/types";
import type { Op } from "../actions";
import { AMOUNT, amountValue, eventLabel, largestAmountAbove, monthOfYear, normalizeText, yearIn, type IntentContext, type IntentParser } from "./shared";

const re = (s: string, flags = "u") => new RegExp(s, flags);
const PER_MONTH = String.raw`(?:(?:a|per|each|every|\/|in\s+a)\s*month|monthly|\/\s*mo\b|p\.?\s?m\.?(?![\p{L}]))`;
const HOME = /\b(house|home|flat|apartment|condo)\b/;

/** Lower-cased text with English thousands commas removed ("1,200,000" → "1200000") and Swiss formats normalised. */
export function normalizeEnglish(text: string): string {
  return normalizeText(text.replace(/(?<![\d.,])(\d{1,3})((?:,\d{3})+)(?![\d]|[.,]\d)/g, (_m, head: string, rest: string) => head + rest.replace(/,/g, "")), "en");
}

export function monthFromEnglish(t: string, now: Date): number | undefined {
  const y = yearIn(t);
  if (y) return monthOfYear(y, now);
  const inYears = t.match(/\bin\s+(\d+)\s+years?\b/);
  if (inYears) return Number(inYears[1]) * 12;
  if (/\bin\s+(?:a|one)\s+year\b/.test(t)) return 12;
  const inMonths = t.match(/\bin\s+(\d+)\s+months?\b/);
  if (inMonths) return Number(inMonths[1]);
  if (/\bnext year\b/.test(t)) return 12;
  return undefined;
}

function parse({ text, house, now }: IntentContext): Op[] {
  const t = normalizeEnglish(text);
  const when = monthFromEnglish(t, now);
  const ops: Op[] = [];

  // retire at 60 / retire early at 62
  const retire = t.match(/retir\w*\s+(?:early\s+)?(?:at|by|when\s+i(?:'|’)?m)\s+(?:age\s+)?(\d{2})\b/);
  if (retire) ops.push({ op: "set", key: "retirementAge", value: Number(retire[1]) });

  // start investing 500 a month / invest 500 per month
  const invest = t.match(re(String.raw`invest\w*\s+(?:an?\s+extra\s+)?${AMOUNT}\s*(?:${PER_MONTH})`));
  if (invest) ops.push({ op: "set", key: "monthlyInvest", value: amountValue(invest[1], invest[2]) });
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
    t.match(re(String.raw`(?:cut|reduce|lower|trim|save)\s+(?:my\s+)?(?:spending|expenses|costs|budget)?\s*(?:by\s+)?${AMOUNT}`)) ??
    t.match(re(String.raw`spend\s+${AMOUNT}\s+less`));
  const more = t.match(re(String.raw`spend\s+${AMOUNT}\s+more`));
  if (cut) ops.push({ op: "set", key: "expenseDelta", value: -amountValue(cut[1], cut[2]) });
  else if (more) ops.push({ op: "set", key: "expenseDelta", value: amountValue(more[1], more[2]) });

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

  // buy a house/flat for X: an explicit "for <amount>" wins, else the largest amount that is not a year
  if (/\b(buy|purchase)\b/.test(t) && HOME.test(t)) {
    const priced = [...t.matchAll(re(String.raw`\bfor\s+${AMOUNT}`, "gu"))].find(([, value, unit]) => unit || !/^20[2-6]\d$/.test(value));
    const price = priced ? amountValue(priced[1], priced[2]) : largestAmountAbove(t, 50_000);
    if (price && price > 50_000) {
      const where = text.match(/\bin\s+([A-ZÄÖÜ][\wäöüé-]+)/);
      const label = eventLabel(where ? { key: "event.homeIn", params: { place: where[1] } } : { key: "event.home" });
      ops.push({ op: "add", type: "house", ...label, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // job loss: the duration is "for 9 months" or a bare "9 months", never the "in 18 months" start
  const job = t.match(/(lose|lost|losing)\s+(my\s+)?job|unemploy|laid off/);
  if (job) {
    const dur = t.match(/\bfor\s+(\d+)\s*months?\b/) ?? t.match(/(?<!\bin\s)\b(\d+)\s*months?\b/);
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

  // raise: CHF per year; "500 a month" is converted, a percentage is left to the model (it needs the salary)
  const raise = t.match(re(String.raw`(?:raise|promotion|salary increase)[^\d%]{0,20}${AMOUNT}(\s*(?:%|percent))?(\s*${PER_MONTH})?`));
  if (raise && !raise[3]) {
    ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount: amountValue(raise[1], raise[2]) * (raise[4] ? 12 : 1) });
  }

  return ops;
}

export const englishIntents: IntentParser = { locale: "en", parse };
