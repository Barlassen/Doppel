/** Local what-if patterns for Swiss Standard German. */
import type { RiskProfile } from "@/lib/finance/types";
import type { Op } from "../actions";
import { lifeOps, type LifeVocab } from "./life";
import { AMOUNT, amountValue, eventLabel, largestAmountAbove, monthOfYear, normalizeText, yearIn, type IntentContext, type IntentParser } from "./shared";

// Every pattern below is written with ae/oe/ue/ss: `foldGerman` maps ä/ö/ü/ß to those digraphs first,
// so «Säule», «Saeule» and «SAEULE» all reach the same regex.
const PER_MONTH = String.raw`(?:(?:pro|im|jeden|je|\/)\s*(?:monat|mt\.?)|monatlich|monatl\.?|mtl\.?|p\.\s?m\.?)(?![\p{L}])`;
const PENSION = String.raw`(?:(?:frueh|vor)?pension\p{L}*|rente|(?:vor)?ruhestand|aufhoer\p{L}*\s+(?:ich\s+|wir\s+)?zu\s+arbeiten|hoer\p{L}*\s+(?:ich\s+|wir\s+)?auf\s+zu\s+arbeiten)`;
const AGE = String.raw`\b(?:mit|ab|bei|auf|im\s+alter(?:\s+von)?)\s+(\d{2})\b(?:\s+jahren)?`;
const SPENDING = "ausgaben|kosten|budget|miete|mietzins";
const CUT = "senk|kuerz|reduzier|verringer|tiefersetz|zurueckfahr";
const DELAY = "verschieb|aufschieb|hinausschieb|hinauszoeger|hinauszieh|nach hinten|zuwart|wart";
const EARLIER = "vorzieh|vorverleg|vorverschieb";
const SPEND_OUT = String.raw`aus(?:g[ei]b\p{L}*|gaben)?(?![\p{L}])`;
const HOME = /haus|wohnung|eigenheim|immobilie|wohneigentum|eigentum|liegenschaft|stockwerkeigentum|stwe|\befh\b/;
const HOME_PRICE = new RegExp(String.raw`\b(?:fuer|kaufpreis(?:\s+von)?)\s+${AMOUNT}`, "gu");
const JOB_LOSS = /(?:job|stelle|arbeit|anstellung)\S*(?:\s+\S+){0,7}?\s+(?:verlier|verloren)|(?:verlier|verloren)\S*(?:\s+\S+){0,5}?\s+(?:job|stelle|arbeit|anstellung)\b|jobverlust|arbeitslos|stellenverlust|stellenlos|kuendigung|gekuendigt|entlassen|entlassung/;
const CHILD_RE = /\b(?:baby|nachwuchs|familienzuwachs|schwanger)|\b(?:ein|unser\w*|zweites|drittes|erstes)\s+kind\b|\bkind\s+(?:bekommen|kriegen)|\bgeburt\s+(?:eines|unseres)\s+kindes\b|\b(?:mutter|vater|eltern)\s+werd|\bwerd\w*\s+(?:ich\s+|wir\s+)?(?:mutter|vater|eltern)\b/;
const MARKET = String.raw`\b(?:boerse|markt|maerkte|aktienkurse)\b`;
const re = (pattern: string) => new RegExp(pattern, "u");

/** Life decisions and economic scenarios (see `life.ts`); patterns run on the folded text (ae/oe/ue/ss). */
const LIFE: LifeVocab = {
  perMonth: PER_MONTH,
  forAmount: String.raw`\b(?:fuer|um)`,
  car: /\b(?:auto|autos|wagen|pkw|fahrzeug|tesla|occasion|motorrad|toeff)\b/,
  lease: /leas/,
  buy: /kauf|anschaff|zuleg|erwerb/,
  ga: /\bga\b|generalabo\p{L}*|general-abo\p{L}*/u,
  home: HOME,
  child: CHILD_RE,
  university: /\b(?:uni|universitaet|eth|epfl|fachhochschule|fh|studier\p{L}*|studium|gymnasium|gymi|matura)\b/u,
  apprenticeship: /\b(?:lehre|lehrstelle|berufslehre)\b/,
  kitaDays: /\b(\d)\s*tage?\b[^.]{0,20}?\b(?:kita|krippe|hort|betreuung|tagesstaette)\b/,
  workload: /\b(\d{1,3})\s*(?:%|prozent)\s*(?:\p{L}+\s+)?(?:arbeit\p{L}*|pensum|stelle|job|teilzeit)|\b(?:pensum|arbeitszeit|arbeitspensum|stelle|teilzeit|arbeit\p{L}*)\b[^.%\d]{0,25}?(\d{1,3})\s*(?:%|prozent)/u,
  halfTime: /\bhalbtags\b|\bhalbe\s+stelle\b/,
  sabbatical: /\b(?:sabbatical|auszeit|unbezahlte[rn]?\s+urlaub|sabbatjahr)\b/,
  forMonths: /(?<!\bin\s)(?<!\d)(\d+)\s*monate?n?\b/,
  forYears: /(?<!\bin\s)(?<!\d)(\d+(?:[.,]5)?)\s*jahre?n?\b/,
  moveTo: /\b[Nn]ach\s+((?:St\.\s+)?\p{Lu}[\p{L}’'.-]+)\s+(?:um)?(?:zieh|zügel|zuegel)\p{L}*|\b(?:[Uu]mzug|[Zz]ieh\p{L}*|[Zz]ügl\p{L}*|[Zz]uegl\p{L}*|[Uu]mzieh\p{L}*)\s+(?:\p{L}+\s+){0,2}?nach\s+((?:St\.\s+)?\p{Lu}[\p{L}’'.-]+)/u,
  move: /\b(?:umzug|umzieh\p{L}*|zuegel\p{L}*|zieh\p{L}*\s+um)\b/u,
  rent: String.raw`\b(?:miete|mietzins)\s+(?:von\s+|fuer\s+|betraegt\s+)?`,
  marry: /\b(?:heirat\p{L}*|hochzeit|verheirat\p{L}*|trauung)\b/u,
  partner: /\bzusammenzieh\p{L}*|\bzieh\p{L}*\s+(?:mit\s+\p{L}+\s+\p{L}+\s+)?zusammen\b|\bzusammen\s+zieh\p{L}*/u,
  partnerEarns: String.raw`\b(?:partner\p{L}*|frau|mann|freund\p{L}*|ehe\p{L}+)\s+(?:verdient|mit)\s+`,
  master: /\b(?:master\p{L}*|mba|msc)\b/u,
  bachelor: /\b(?:bachelor\p{L}*|bsc)\b/u,
  education: /\b(?:weiterbildung|doktorat|nachdiplom\p{L}*|umschulung|studium|studier\p{L}*)\b/u,
  fullTime: /\bvollzeit\p{L}*/u,
  selfEmployed: /\bselbst(?:st)?aendig\p{L}*|\bfreiberuf\p{L}*|\bfreelanc\p{L}*|\beigene[sn]?\s+(?:firma|geschaeft|unternehmen)|\b(?:firma|unternehmen|startup)\s+gruend\p{L}*/u,
  earning: String.raw`\b(?:verdien\p{L}*|einkommen\s+von|lohn\s+von)\s+`,
  inherit: /\b(?:erbe|erben|erbst|erbt|erbschaft|schenkung|lottogewinn)\b/,
  heatPump: /\bwaermepumpe\b/,
  economy: {
    high_inflation: /\bhohe\p{L}*\s+(?:inflation|teuerung)|\b(?:inflation|teuerung)\s+(?:steigt|bleibt\s+hoch|hoch\s+bleibt|zieht\s+an|bei\s+\d)|\b(?:hypothekar)?zinsen\s+(?:steigen|erhoeh\p{L}*|klettern|auf\s+\d)/u,
    recession: /\brezessions?szenario|\bszenario\W+rezession|\bwirtschaftskrise\b/,
    low_rates: /\b(?:tiefzins\p{L}*|niedrigzins\p{L}*|negativzins\p{L}*|tiefe\p{L}*\s+zinsen|nullzinsen)\b/u,
    climate_transition: /\bklima(?:wandel|szenario|stress|schock|transition)\p{L}*/u,
    baseline: /\bbasisszenario\b|\bnormale\s+wirtschaft\b/,
  },
};
const MARKET_FALLS = re(String.raw`${MARKET}[^.!?]{0,50}?\b(?:stuerz|einbr|kollabier|krach|tauch|sink|faell|fall(?:en|t)\b|rutsch|br(?:icht|echen)\b[^.!?]{0,30}?\bein\b)|\bbr(?:icht|echen)\b[^.!?]{0,35}?${MARKET}\s+ein\b`);

const RISK_TERMS = {
  conservative: String.raw`konservativ|defensiv|sicherer|vorsichtig|sicherheit|weniger (?:aktien|risiko)|risiko\s+(?:senk|reduzier|verringer|zurueckfahr)`,
  balanced: "ausgewogen|ausgeglichen",
  growth: String.raw`wachstum|aggressiv|offensiv|dynamisch|risikoreicher|risikofreudig|mutiger|mehr (?:aktien|risiko)|risiko\s+(?:erhoeh|steiger|hochfahr)`,
} satisfies Record<RiskProfile, string>;
const RISK_WORDS = Object.values(RISK_TERMS).join("|");
const RISK_PROFILES = (Object.entries(RISK_TERMS) as [RiskProfile, string][])
  .map(([profile, terms]) => ({ profile, terms: re(String.raw`^(?:${terms})$`) }));

const UNITS: Record<string, number> = { ein: 1, eine: 1, einem: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12 };
const TENS: Record<string, number> = { fuenfzig: 50, sechzig: 60, siebzig: 70 };
const UNIT_PREFIX = "ein|zwei|drei|vier|fuenf|sechs|sieben|acht|neun";

/** Lower-cased, number-normalised text with ä/ö/ü/ß written as ae/oe/ue/ss. */
function foldGerman(text: string): string {
  let t = normalizeText(text, "de")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    // Swiss slang for francs, as in «500 Stutz pro Monat».
    .replace(/(?<![\p{L}])(?:stutz|fraenkli)(?![\p{L}])/gu, " ");
  // «ein halbes Jahr», «anderthalb Jahre» → months, so «in einem halben Jahr» and «ein Jahr lang» parse.
  t = t.replace(/\b(?:ein(?:e[mn]?)?\s+)?halbe[mns]?\s+jahre?[ns]?\b/g, "6 monate");
  t = t.replace(/\b(?:anderthalb|eineinhalb)\s+jahre?[ns]?\b/g, "18 monate");
  // «ein Jahr», «zwei Jahre», «in drei Monaten» → digits (only before a duration unit).
  t = t.replace(/\b(einem|einen|eine|ein|zwei|drei|vier|fuenf|sechs|sieben|acht|neun|zehn|elf|zwoelf)\s+(jahre?n?|monate?n?)\b/g, (_m, word: string, unit: string) => `${UNITS[word]} ${unit}`);
  // «eine halbe Million», «zwei Millionen» → plain numbers.
  t = t.replace(/\beine\s+halbe\s+million(?:en)?\b/g, "500000");
  t = t.replace(/\b(eine|zwei|drei|vier|fuenf)\s+million(?:en)?\b/g, (_m, word: string) => `${UNITS[word]}000000`);
  // Written-out ages: «mit sechzig», «mit zweiundsechzig».
  t = t.replace(new RegExp(String.raw`\b(?:(${UNIT_PREFIX})und)?(fuenfzig|sechzig|siebzig)\b`, "g"), (_m, unit: string | undefined, tens: string) => String(TENS[tens] + (unit ? UNITS[unit] : 0)));
  return t;
}

function monthFrom(t: string, now: Date): number | undefined {
  const y = yearIn(t);
  if (y) return monthOfYear(y, now);
  const inYears = t.match(/\bin\s+(\d+)\s+jahr/);
  if (inYears) return Number(inYears[1]) * 12;
  const inMonths = t.match(/\bin\s+(\d+)\s+monat/);
  if (inMonths) return Number(inMonths[1]);
  if (/\b(?:naechste[ns]?|kommende[ns]?|folgende[ns]?)\s+jahr\b/.test(t)) return 12;
  return undefined;
}

function parse(ctx: IntentContext): Op[] {
  const { text, house, now } = ctx;
  const t = foldGerman(text);
  const when = monthFrom(t, now);
  const ops: Op[] = [];

  // «Mit 60 in Pension», «mit 62 lasse ich mich pensionieren», «bis 63 arbeiten».
  const retire =
    t.match(re(String.raw`${AGE}[^.!?\d]{0,40}?\b${PENSION}\b`)) ??
    t.match(re(String.raw`\b${PENSION}\b[^.!?\d]{0,30}?${AGE}`)) ??
    t.match(re(String.raw`\bbis\s+(?:zum\s+alter\s+von\s+|alter\s+)?(\d{2})\b(?:\s+jahren?)?\s+(?:noch\s+)?arbeit`)) ??
    t.match(re(String.raw`\barbeit\p{L}*\s+(?:nur\s+)?(?:noch\s+)?bis\s+(?:zum\s+alter\s+von\s+|alter\s+)?(\d{2})\b`));
  if (retire) ops.push({ op: "set", key: "retirementAge", value: Number(retire[1]) });

  // The amount can appear on either side of the monthly cadence.
  if (/investier|investition|anleg|geldanlage|sparplan|dauerauftrag|\bleg\p{L}*\b[^.!?]{0,45}?\ban\b|\bin\s+(?:(?:ein\p{L}*|den)\s+)?(?:fonds|etfs?|aktien)\b/u.test(t)) {
    const m = t.match(re(String.raw`${AMOUNT}\s*${PER_MONTH}`))
      ?? t.match(re(String.raw`${PER_MONTH}\s+${AMOUNT}`))
      ?? t.match(re(String.raw`${PER_MONTH}\s+(?:\p{L}+\s+){1,4}${AMOUNT}`))
      ?? t.match(re(String.raw`\bdauerauftrag\s+(?:ueber|von)\s+${AMOUNT}`));
    if (m) ops.push({ op: "set", key: "monthlyInvest", value: amountValue(m[1], m[2]) });
    else if (/(freie[ns]?|ueberschuessige[ns]?|liegende[ns]?|ungenutzte[ns]?)\s+(geld|cash|bargeld|liquiditaet)|cash\s+(investieren|anlegen)/.test(t))
      ops.push({ op: "set", key: "optimize", value: true });
  } else if (/geld\s+arbeiten\s+lassen/.test(t)) ops.push({ op: "set", key: "optimize", value: true });

  // Prefer the destination in «von defensiv auf Wachstum wechseln».
  if (/risiko|strategie|portfolio|profil|wechsl|wechsel|umstell|anleg|investier|\bsei\b|werd|mehr|weniger|geh|setz/.test(t)) {
    const wanted = t.match(re(String.raw`\b(?:auf|zu)\s+(?:(?:ein\p{L}*|d(?:as|e[nmrs]|ie))\s+)?(${RISK_WORDS})`))
      ?? t.match(re(String.raw`\b(${RISK_WORDS})`));
    const risk = wanted && RISK_PROFILES.find(({ terms }) => terms.test(wanted[1]));
    if (risk) ops.push({ op: "set", key: "riskProfile", value: risk.profile });
  }

  // «Fixkosten um 400 senken», «monatlich 400 weniger ausgeben», «400 einsparen», «Kostensenkung von 400».
  const cut =
    t.match(re(String.raw`(?:${SPENDING})\s+(?:${PER_MONTH}\s+)?(?:um\s+)?${AMOUNT}\s*(?:${PER_MONTH}\s*)?(?:${CUT})`)) ??
    t.match(re(String.raw`(?:${CUT}|\b(?:ein)?spar)\p{L}*\s+(?:(?:ich|wir|meine|unsere|die|${PER_MONTH})\s+)*(?:\p{L}*?(?:${SPENDING})\s+)?(?:um\s+)?${AMOUNT}`)) ??
    t.match(re(String.raw`${AMOUNT}\s*(?:${PER_MONTH}\s*)?(?:weniger\s+(?:${PER_MONTH}\s+)?${SPEND_OUT}|einspar)`)) ??
    t.match(re(String.raw`(?:${SPENDING})(?:senkung|reduktion|reduzierung|kuerzung)\s+(?:(?:von|um)\s+)?${AMOUNT}`));
  const more =
    t.match(re(String.raw`${AMOUNT}\s*(?:${PER_MONTH}\s*)?mehr\s+(?:${PER_MONTH}\s+)?${SPEND_OUT}`));
  if (cut) ops.push({ op: "set", key: "expenseDelta", value: -amountValue(cut[1], cut[2]) });
  else if (more) ops.push({ op: "set", key: "expenseDelta", value: amountValue(more[1], more[2]) });

  if (/\b3a\b|s(?:ae|a)ule\s*3|3\.\s*s(?:ae|a)ule|dritte\p{L}*\s+s(?:ae|a)ule/u.test(t)) {
    if (/stopp|aufhoer|pausier|aussetz|sistier|einstell|auslass|\bnicht\s+mehr|\bnicht\s+(?:einzahl|einleg|bespar)|\bkeine?\b/.test(t))
      ops.push({ op: "set", key: "contributes3a", value: false });
    else if (/maxim|hoechstbetrag|voll|start|beginn|anfang|fang|eroeffn|einzahl|einleg|nutz|ausschoepf|ausreiz|alimentier|bespar/.test(t))
      ops.push({ op: "set", key: "contributes3a", value: true });
  }

  // «Noch 6 Monate zuwarten», «Kauf um 2 Jahre nach hinten schieben», «Kauf um ein Jahr vorziehen».
  const homeTalk = HOME.test(t) || /kauf|erwerb/.test(t);
  const otherTalk = retire || /pension|rente|ruhestand|arbeitslos|stelle|job\b|baby|kind|crash|boerse/.test(t);
  const delay =
    t.match(re(String.raw`(?<!in )\b(\d+)\s*(jahr|monat)\p{L}*\s+(?:spaeter|${DELAY})`)) ??
    t.match(re(String.raw`\b(?:${DELAY})\p{L}*[^.!?\d]{0,40}?(?<!in )\b(\d+)\s*(jahr|monat)`)) ??
    t.match(/\bschieb\w*\b[^.!?\d]{0,45}?\b(\d+)\s*(jahr|monat)\w*\s+(?:auf|hinaus|nach hinten)\b/);
  const earlier = homeTalk && !retire
    ? t.match(re(String.raw`(?<!in )\b(\d+)\s*(jahr|monat)\p{L}*\s+(?:frueher|vorher|${EARLIER})`))
      ?? t.match(re(String.raw`(?:${EARLIER})\p{L}*[^.!?\d]{0,40}?(?<!in )\b(\d+)\s*(jahr|monat)`))
    : null;
  let shifted = false;
  if (house && delay && (homeTalk || !otherTalk)) {
    ops.push({ op: "shift", id: house.id, months: Number(delay[1]) * (delay[2] === "jahr" ? 12 : 1) });
    shifted = true;
  } else if (house && earlier) {
    ops.push({ op: "shift", id: house.id, months: -Number(earlier[1]) * (earlier[2] === "jahr" ? 12 : 1) });
    shifted = true;
  } else if (house && homeTalk && !otherTalk && /verschieb|aufschieb|hinausschieb|zuwart|vorzieh|vorverleg/.test(t)) {
    // «Den Hauskauf auf 2030 verschieben» → the distance from the planned month to mid-2030.
    const target = yearIn(t);
    const months = target ? monthOfYear(target, now) - house.month : 0;
    if (months) {
      ops.push({ op: "shift", id: house.id, months });
      shifted = true;
    }
  }

  // Prefer an explicit purchase price to other amounts in the same sentence.
  if (!shifted && !delay && /kauf|erwerb/.test(t) && HOME.test(t)) {
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
    const months = t.match(/\bfuer\s+(\d+)\s*monat/)
      ?? t.match(/(?<!in )\b(\d+)\s*monate?(?:\s+lang)?\b/);
    const years = !months && (t.match(/\bfuer\s+(\d+)\s*jahr/) ?? t.match(/(?<!in )\b(\d+)\s*jahre?\s+(?:lang|ohne|arbeitslos|stellenlos)\b/));
    const duration = months ? Number(months[1]) : years ? Number(years[1]) * 12 : 6;
    ops.push({ op: "add", type: "jobloss", ...eventLabel({ key: "event.jobLoss" }), month: when ?? 12, amount: 0, duration });
  }

  if ((/crash|boersen(?:einbruch|sturz)|markt(?:einbruch|absturz)|kurssturz|rezession/.test(t) || MARKET_FALLS.test(t)) && !/szenario|wirtschaftskrise/.test(t)) {
    ops.push({ op: "add", type: "crash", ...eventLabel({ key: "event.crash" }), month: when ?? 12, amount: 0 });
  }

  // «Lohnerhöhung von 500», «500 mehr Lohn pro Monat».
  // The engine takes CHF per year: «500 pro Monat» is converted; a percentage needs the salary and is left to the model.
  const raise = t.match(re(String.raw`(?:lohnerhoehung|gehaltserhoehung|befoerderung)[^\d%]{0,20}${AMOUNT}(\s*(?:%|prozent))?(\s*${PER_MONTH})?`))
    ?? t.match(re(String.raw`${AMOUNT}(\s*(?:%|prozent))?(\s*${PER_MONTH})?\s*mehr\s+(?:lohn|gehalt)`));
  if (raise && !raise[3]) {
    ops.push({ op: "add", type: "raise", ...eventLabel({ key: "event.raise" }), month: when ?? 6, amount: amountValue(raise[1], raise[2]) * (raise[4] ? 12 : 1) });
  }

  // Kind, Auto, Pensum, Umzug, Heirat, Weiterbildung, Selbstständigkeit, Erbschaft, Anschaffung, Wirtschaftslage
  ops.push(...lifeOps(LIFE, t, ctx, when, ops));
  return ops;
}

export const germanIntents: IntentParser = { locale: "de", parse };
