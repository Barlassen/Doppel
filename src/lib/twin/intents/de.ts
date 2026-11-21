/** Local what-if patterns for Swiss Standard German. */
import type { RiskProfile } from "@/lib/finance/types";
import type { Op } from "../actions";
import { AMOUNT, amountValue, eventLabel, largestAmountAbove, monthOfYear, normalizeText, yearIn, type IntentContext, type IntentParser } from "./shared";

const PER_MONTH = String.raw`(?:(?:pro|im|jeden|je|\/)\s*(?:monat|mt\.?)|monatlich|mtl\.?|p\.\s?m\.?)(?![\p{L}])`;
const PENSION = String.raw`(?:(?:früh)?pension\p{L}*|rente|ruhestand|aufhören\s+zu\s+arbeiten)`;
const AGE = String.raw`\b(?:mit|ab|bei)\s+(\d{2})\b(?:\s+jahren)?`;
const SPENDING = "ausgaben|kosten|budget";
const CUT = "senk|kürz|reduzier|verringer|tiefersetz";
const DELAY = "verschieb|aufschieb|hinausschieb|hinauszöger|hinauszieh|nach hinten|zuwart|wart";
const HOME = /haus|wohnung|eigenheim|immobilie|wohneigentum|eigentum|liegenschaft/;
const HOME_PRICE = new RegExp(String.raw`\b(?:für|kaufpreis(?:\s+von)?)\s+${AMOUNT}`, "gu");
const JOB_LOSS = /(?:job|stelle|arbeit|anstellung)\S*(?:\s+\S+){0,7}?\s+(?:verlier|verloren)|(?:verlier|verloren)\S*(?:\s+\S+){0,5}?\s+(?:job|stelle|arbeit|anstellung)\b|jobverlust|arbeitslos|stellenverlust|stellenlos|kündigung|gekündigt|entlassen|entlassung/;
const MARKET = String.raw`\b(?:börse|markt|märkte|aktienkurse)\b`;
const re = (pattern: string) => new RegExp(pattern, "u");
const MARKET_FALLS = re(String.raw`${MARKET}[^.!?]{0,50}?\b(?:stürz|einbr|kollabier|krach|br(?:icht|echen)\b[^.!?]{0,30}?\bein\b)|\bbr(?:icht|echen)\b[^.!?]{0,35}?${MARKET}\s+ein\b`);

const RISK_TERMS = {
  conservative: "konservativ|defensiv|sicherer|vorsichtig|sicherheit|weniger (?:aktien|risiko)",
  balanced: "ausgewogen|ausgeglichen",
  growth: "wachstum|aggressiv|offensiv|dynamisch|risikoreicher|mehr (?:aktien|risiko)",
} satisfies Record<RiskProfile, string>;
const RISK_WORDS = Object.values(RISK_TERMS).join("|");
const RISK_PROFILES = (Object.entries(RISK_TERMS) as [RiskProfile, string][])
  .map(([profile, terms]) => ({ profile, terms: re(String.raw`^(?:${terms})$`) }));

function monthFrom(t: string, now: Date): number | undefined {
  const y = yearIn(t);
  if (y) return monthOfYear(y, now);
  const inYears = t.match(/\bin\s+(\d+)\s+jahr/);
  if (inYears) return Number(inYears[1]) * 12;
  const inMonths = t.match(/\bin\s+(\d+)\s+monat/);
  if (inMonths) return Number(inMonths[1]);
  if (/\b(?:nächste[ns]?|kommende[ns]?|folgende[ns]?)\s+jahr\b/.test(t)) return 12;
  return undefined;
}

function parse({ text, house, now }: IntentContext): Op[] {
  const t = normalizeText(text, "de");
  const when = monthFrom(t, now);
  const ops: Op[] = [];

  // «Mit 60 in Pension», «mit 62 lasse ich mich pensionieren».
  const retire =
    t.match(re(String.raw`${AGE}[^.!?\d]{0,40}?\b${PENSION}\b`)) ??
    t.match(re(String.raw`\b${PENSION}\b[^.!?\d]{0,30}?${AGE}`));
  if (retire) ops.push({ op: "set", key: "retirementAge", value: Number(retire[1]) });

  // The amount can appear on either side of the monthly cadence.
  if (/investier|investition|anleg|geldanlage|sparplan|dauerauftrag|\bleg\p{L}*\b[^.!?]{0,45}?\ban\b|\bin\s+(?:(?:ein\p{L}*|den)\s+)?(?:fonds|etfs?|aktien)\b/u.test(t)) {
    const m = t.match(re(String.raw`${AMOUNT}\s*${PER_MONTH}`))
      ?? t.match(re(String.raw`${PER_MONTH}\s+${AMOUNT}`))
      ?? t.match(re(String.raw`${PER_MONTH}\s+(?:\p{L}+\s+){1,4}${AMOUNT}`))
      ?? t.match(re(String.raw`\bdauerauftrag\s+(?:über|von)\s+${AMOUNT}`));
    if (m) ops.push({ op: "set", key: "monthlyInvest", value: amountValue(m[1], m[2]) });
    else if (/(freie[ns]?|überschüssige[ns]?|liegende[ns]?|ungenutzte[ns]?)\s+(geld|cash|bargeld|liquidität)|cash\s+(investieren|anlegen)/.test(t))
      ops.push({ op: "set", key: "optimize", value: true });
  } else if (/geld\s+arbeiten\s+lassen/.test(t)) ops.push({ op: "set", key: "optimize", value: true });

  // Prefer the destination in «von defensiv auf Wachstum wechseln».
  if (/risiko|strategie|portfolio|profil|wechsl|wechsel|umstell|anleg|investier|\bsei\b|werd|mehr|weniger|geh|setz/.test(t)) {
    const wanted = t.match(re(String.raw`\b(?:auf|zu)\s+(?:(?:ein\p{L}*|d(?:as|e[nmrs]|ie))\s+)?(${RISK_WORDS})`))
      ?? t.match(re(String.raw`\b(${RISK_WORDS})`));
    const risk = wanted && RISK_PROFILES.find(({ terms }) => terms.test(wanted[1]));
    if (risk) ops.push({ op: "set", key: "riskProfile", value: risk.profile });
  }

  // «Fixkosten um 400 senken», «monatlich 400 weniger ausgeben», «400 einsparen».
  const cut =
    t.match(re(String.raw`(?:${SPENDING})\s+(?:${PER_MONTH}\s+)?(?:um\s+)?${AMOUNT}\s*(?:${PER_MONTH}\s*)?(?:${CUT})`)) ??
    t.match(re(String.raw`(?:${CUT}|\b(?:ein)?spar)\p{L}*\s+(?:(?:ich|wir|meine|unsere|die|${PER_MONTH})\s+)*(?:\p{L}*?(?:${SPENDING})\s+)?(?:um\s+)?${AMOUNT}`)) ??
    t.match(re(String.raw`${AMOUNT}\s*(?:${PER_MONTH}\s*)?(?:weniger\s+(?:${PER_MONTH}\s+)?aus(?:g[ei]b|gaben)|einspar)`));
  const more = t.match(re(String.raw`${AMOUNT}\s*(?:${PER_MONTH}\s*)?mehr\s+(?:${PER_MONTH}\s+)?aus(?:g[ei]b|gaben)`));
  if (cut) ops.push({ op: "set", key: "expenseDelta", value: -amountValue(cut[1], cut[2]) });
  else if (more) ops.push({ op: "set", key: "expenseDelta", value: amountValue(more[1], more[2]) });

  if (/\b3a\b|säule\s*3|3\.\s*säule|dritte\p{L}*\s+säule/u.test(t)) {
    if (/stopp|aufhör|pausier|aussetz|sistier|einstell|auslass|\bnicht\s+mehr|\bnicht\s+(?:einzahl|einleg|bespar)|\bkeine?\b/.test(t))
      ops.push({ op: "set", key: "contributes3a", value: false });
    else if (/maxim|höchstbetrag|voll|start|beginn|anfang|fang|eröffn|einzahl|einleg|nutz|ausschöpf|ausreiz|alimentier|bespar/.test(t))
      ops.push({ op: "set", key: "contributes3a", value: true });
  }

  // «Noch 6 Monate zuwarten», «Kauf um 2 Jahre nach hinten schieben».
  const delay =
    t.match(re(String.raw`(?<!in )\b(\d+)\s*(jahr|monat)\p{L}*\s+(?:später|${DELAY})`)) ??
    t.match(re(String.raw`\b(?:${DELAY})\p{L}*[^.!?\d]{0,40}?(?<!in )\b(\d+)\s*(jahr|monat)`)) ??
    t.match(/\bschieb\w*\b[^.!?\d]{0,45}?\b(\d+)\s*(jahr|monat)\w*\s+(?:auf|hinaus|nach hinten)\b/);
  if (delay && house) ops.push({ op: "shift", id: house.id, months: Number(delay[1]) * (delay[2] === "jahr" ? 12 : 1) });

  // Prefer an explicit purchase price to other amounts in the same sentence.
  if (!delay && /kauf|erwerb/.test(t) && HOME.test(t)) {
    const priced = [...t.matchAll(HOME_PRICE)].find(([, value, unit]) => unit || !/^20[2-6]\d$/.test(value));
    const price = priced ? amountValue(priced[1], priced[2]) : largestAmountAbove(t, 50_000);
    if (price) {
      const where = text.match(/\b[Ii]n\s+((?:St\.\s+)?\p{Lu}[\p{L}’'-]+)(?<!\bJahr)\b/u);
      const label = eventLabel(where ? { key: "event.homeIn", params: { place: where[1] } } : { key: "event.home" });
      ops.push({ op: "add", type: "house", ...label, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // «Stellenlos» and «ohne Stelle» are common in Switzerland.
  if (JOB_LOSS.test(t) || /\bohne\s+(?:job|stelle|arbeit|anstellung)\b/.test(t)) {
    const dur = t.match(/\bfür\s+(\d+)\s*monat/)
      ?? t.match(/(?<!in )\b(\d+)\s*monate?(?:\s+lang)?\b/);
    ops.push({ op: "add", type: "jobloss", ...eventLabel({ key: "event.jobLoss" }), month: when ?? 12, amount: 0, duration: dur ? Number(dur[1]) : 6 });
  }

  if (/crash|börsen(?:einbruch|sturz)|markt(?:einbruch|absturz)|kurssturz|rezession/.test(t) || MARKET_FALLS.test(t)) {
    ops.push({ op: "add", type: "crash", ...eventLabel({ key: "event.crash" }), month: when ?? 12, amount: 0 });
  }

  if (/\b(?:baby|nachwuchs|familienzuwachs|schwanger)|\b(?:ein|unser\w*|zweites|drittes|erstes)\s+kind\b|\bkind\s+bekommen|\bgeburt\s+(?:eines|unseres)\s+kindes\b|\b(?:mutter|vater|eltern)\s+werd|\bwerd\w*\s+(?:ich\s+|wir\s+)?(?:mutter|vater|eltern)\b/.test(t)) {
    ops.push({ op: "add", type: "child", ...eventLabel({ key: "event.baby" }), month: when ?? 18, amount: 1500, duration: 216 });
  }

  const raise = t.match(re(String.raw`(lohnerhöhung|gehaltserhöhung|beförderung)\D{0,20}${AMOUNT}`));
  if (raise) ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount: amountValue(raise[2], raise[3]) });

  return ops;
}

export const germanIntents: IntentParser = { locale: "de", parse };
