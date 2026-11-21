/**
 * German (Swiss Standard German) what-if patterns — first draft.
 * "Mit 60 in Pension gehen", "500 pro Monat investieren", "Ausgaben um 400 senken", "3a maximieren",
 * "Was, wenn ich 2028 meinen Job für 6 Monate verliere?", "Börsencrash nächstes Jahr",
 * "Wir bekommen 2028 ein Baby", "Wohnungskauf um 2 Jahre verschieben", "Wohnung in Bern für 1,2 Mio. kaufen".
 */
import type { RiskProfile } from "@/lib/finance/types";
import type { Op } from "../actions";
import { AMOUNT, amountValue, eventLabel, largestAmountAbove, monthOfYear, normalizeText, yearIn, type IntentContext, type IntentParser } from "./shared";

const PER_MONTH = String.raw`(?:pro|im|jeden|je|\/)\s*monat|monatlich|mtl\.?|p\.\s?m\.?|\/\s*mt\.?`;
const re = (s: string) => new RegExp(s, "u");

function monthFrom(t: string, now: Date): number | undefined {
  const y = yearIn(t);
  if (y) return monthOfYear(y, now);
  const inYears = t.match(/\bin\s+(\d+)\s+jahr/);
  if (inYears) return Number(inYears[1]) * 12;
  const inMonths = t.match(/\bin\s+(\d+)\s+monat/);
  if (inMonths) return Number(inMonths[1]);
  if (/(nächste[ns]?|kommende[ns]?)\s+jahr/.test(t)) return 12;
  return undefined;
}

function parse({ text, house, now }: IntentContext): Op[] {
  const t = normalizeText(text, "de");
  const when = monthFrom(t, now);
  const ops: Op[] = [];

  // mit 60 in Pension gehen / mit 62 pensioniert werden / Pensionierung mit 63 / Frühpensionierung mit 60
  const retire =
    t.match(/\b(?:mit|ab)\s+(\d{2})(?:\s*jahren)?\s+(?:in\s+(?:die\s+)?(?:pension|rente|ruhestand)|(?:früh)?pensionier|aufhören\s+zu\s+arbeiten)/) ??
    t.match(/(?:pension|rente|ruhestand|pensionier\w*|frühpension\w*)\D{0,20}?\b(?:mit|ab|bei)\s+(\d{2})\b/);
  if (retire) ops.push({ op: "set", key: "retirementAge", value: Number(retire[1]) });

  // 500 pro Monat investieren / monatlich 500 anlegen / Dauerauftrag 300 pro Monat
  if (/investier|anleg|sparplan|dauerauftrag/.test(t)) {
    const m = t.match(re(`${AMOUNT}\\s*(?:${PER_MONTH})`)) ?? t.match(re(`(?:${PER_MONTH})\\s+${AMOUNT}`));
    if (m) ops.push({ op: "set", key: "monthlyInvest", value: amountValue(m[1], m[2]) });
    else if (/(freie[ns]?|überschüssige[ns]?|liegende[ns]?|ungenutzte[ns]?)\s+(geld|cash|bargeld|liquidität)|cash\s+(investieren|anlegen)/.test(t))
      ops.push({ op: "set", key: "optimize", value: true });
  } else if (/geld\s+arbeiten\s+lassen/.test(t)) ops.push({ op: "set", key: "optimize", value: true });

  // auf Wachstum umstellen / Risikoprofil konservativ / ausgewogen investieren
  if (/(risiko|strategie|portfolio|profil|wechsl|wechsel|umstell|anleg|investier|\bsei\b|werde|mehr|geh)/.test(t)) {
    const w = t.match(/(konservativ|defensiv|sicherer|vorsichtig|ausgewogen|ausgeglichen|wachstum|aggressiv|offensiv|dynamisch|risikoreicher)/);
    if (w) {
      const value: RiskProfile = /ausgewogen|ausgeglichen/.test(w[1])
        ? "balanced"
        : /wachstum|aggressiv|offensiv|dynamisch|risikoreicher/.test(w[1])
          ? "growth"
          : "conservative";
      ops.push({ op: "set", key: "riskProfile", value });
    }
  }

  // Ausgaben um 400 senken / 400 pro Monat weniger ausgeben / spare 300 / 200 mehr ausgeben
  const cut =
    t.match(re(`(?:ausgaben|kosten|budget)\\s+(?:um\\s+)?${AMOUNT}\\s*(?:(?:${PER_MONTH})\\s*)?(?:senken|kürzen|reduzieren|verringern)`)) ??
    t.match(re(`(?:senke|kürze|reduziere|spare|sparen|senken|kürzen|reduzieren)\\s+(?:ich\\s+)?(?:meine\\s+|die\\s+)?(?:ausgaben\\s+|kosten\\s+)?(?:um\\s+)?${AMOUNT}`)) ??
    t.match(re(`${AMOUNT}\\s*(?:(?:${PER_MONTH})\\s*)?weniger\\s+aus(?:geben|gaben)`));
  const more = t.match(re(`${AMOUNT}\\s*(?:(?:${PER_MONTH})\\s*)?mehr\\s+aus(?:geben|gaben)`));
  if (cut) ops.push({ op: "set", key: "expenseDelta", value: -amountValue(cut[1], cut[2]) });
  else if (more) ops.push({ op: "set", key: "expenseDelta", value: amountValue(more[1], more[2]) });

  // 3a maximieren / Säule 3a starten / keine 3a mehr / 3a stoppen
  if (/\b3a\b|säule\s*3|3\.\s*säule|dritte\s+säule/.test(t)) {
    if (/(stopp|aufhör|pausier|nicht\s+mehr|keine)/.test(t)) ops.push({ op: "set", key: "contributes3a", value: false });
    else if (/(maxim|voll|start|beginn|eröffn|einzahl|nutz|ausschöpf)/.test(t)) ops.push({ op: "set", key: "contributes3a", value: true });
  }

  // Wohnungskauf um 2 Jahre verschieben / Hauskauf 6 Monate später / Kauf verschieben um 1 Jahr
  const delay =
    t.match(/(\d+)\s*(jahr|monat)\w*\s+(?:später|verschieb|aufschieb|hinaus|warten)/) ??
    t.match(/(?:verschieb|aufschieb|hinauszöger|warte)\S*\D{0,30}?(\d+)\s*(jahr|monat)/);
  if (delay && house) ops.push({ op: "shift", id: house.id, months: Number(delay[1]) * (delay[2] === "jahr" ? 12 : 1) });

  // Wohnung in Bern für 1,2 Mio. kaufen / Haus für 900k kaufen
  if (/(kauf|erwerb)/.test(t) && /(haus|wohnung|eigenheim|immobilie|wohneigentum|eigentum)/.test(t)) {
    const price = largestAmountAbove(t, 50_000);
    if (price) {
      const where = text.match(/\bin\s+([A-ZÄÖÜ][\p{L}-]+)/u);
      const label = eventLabel(where ? { key: "event.homeIn", params: { place: where[1] } } : { key: "event.home" });
      ops.push({ op: "add", type: "house", ...label, month: when ?? house?.month ?? 24, amount: price });
    }
  }

  // Job verlieren / Jobverlust / arbeitslos / Kündigung
  if (/(job|stelle|arbeit|anstellung)\S*\s+(?:\S+\s+){0,4}?(verlier|verloren)|jobverlust|arbeitslos|stellenverlust|kündigung|gekündigt|entlassen|entlassung/.test(t)) {
    const dur = t.match(/(\d+)\s*monat/);
    ops.push({ op: "add", type: "jobloss", ...eventLabel({ key: "event.jobLoss" }), month: when ?? 12, amount: 0, duration: dur ? Number(dur[1]) : 6 });
  }

  // Börsencrash / Kurssturz / Rezession
  if (/crash|börsen(?:einbruch|sturz)|markt(?:einbruch|absturz)|kurssturz|rezession/.test(t)) {
    ops.push({ op: "add", type: "crash", ...eventLabel({ key: "event.crash" }), month: when ?? 12, amount: 0 });
  }

  // Baby / Nachwuchs / ein Kind bekommen
  if (/\b(baby|nachwuchs|schwanger)|\b(ein|unser\w*|zweites|drittes|erstes)\s+kind\b|\bkind\s+bekommen/.test(t)) {
    ops.push({ op: "add", type: "child", ...eventLabel({ key: "event.baby" }), month: when ?? 18, amount: 1500, duration: 216 });
  }

  // Lohnerhöhung von 10k
  const raise = t.match(re(`(lohnerhöhung|gehaltserhöhung|beförderung)\\D{0,20}${AMOUNT}`));
  if (raise) ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount: amountValue(raise[2], raise[3]) });

  return ops;
}

export const germanIntents: IntentParser = { locale: "de", parse };
