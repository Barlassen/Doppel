import { PROFILES } from "../src/lib/data/profiles";
import { DICTIONARIES, FORMATS, LOCALES, PLACEHOLDER, createFmt, type Locale } from "../src/lib/i18n";
import { commandExamples, type EXAMPLE_IDS } from "../src/lib/i18n/examples";
import { localParseCommand, validateLocalOps, type Op } from "../src/lib/twin/actions";
import { orderedParsers } from "../src/lib/twin/intents";

const allowUntranslated = process.argv.includes("--allow-untranslated");
const formats = new Set<string>(FORMATS);
const unchanged = new Set([
  "tier.1", "tier.2", "route.offline-template",
  "common.deltaChf", "common.priceLabel", "common.arrow", "common.separator", "cmd.result", "insight.subsItem",
  "common.tokens_one", "common.tokens_other", "inspector.tok",
  "timeline.amount", "narr.bestMove", "route.cache", "inspector.oursHeader",
]);

function flatten(value: unknown, errors: string[], key = "", leaves = new Map<string, string>()): Map<string, string> {
  if (typeof value === "string") {
    leaves.set(key, value);
    if (!value.trim()) errors.push(key + " is empty");
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (!entries.length) errors.push(key + " has no leaves");
    for (const [part, child] of entries) flatten(child, errors, key ? key + "." + part : part, leaves);
  } else {
    errors.push(key + " must be a string or a message group");
  }
  return leaves;
}

function placeholders(value: string, key: string, errors: string[]) {
  const found = new Set<string>();
  for (const [token, , format] of value.matchAll(PLACEHOLDER)) {
    if (format && !formats.has(format)) errors.push(key + " has an unknown number format: " + format);
    found.add(token);
  }
  if (/[{}]/.test(value.replace(PLACEHOLDER, ""))) errors.push(key + " has a malformed placeholder");
  return [...found].sort().join(" ");
}

// Compare exact fields for each intent while permitting display descriptors and default metadata.
type ExpectedOp = Partial<Extract<Op, { op: "add" }>>
  | Partial<Extract<Op, { op: "set" }>>
  | Partial<Extract<Op, { op: "shift" }>>;
type IntentCase = [text: string, expected: ExpectedOp];
const now = new Date(2026, 0, 15);
const events = PROFILES[0].events;
const july2028 = 30;
const buy: ExpectedOp = { op: "add", type: "house", amount: 1_200_000, month: july2028 };
const monthly = (value: number): ExpectedOp => ({ op: "set", key: "monthlyInvest", value });
const spend: ExpectedOp = { op: "set", key: "expenseDelta", value: -400 };
const profile: ExpectedOp = { op: "set", key: "riskProfile", value: "growth" };
const start3a: ExpectedOp = { op: "set", key: "contributes3a", value: true };
const stop3a: ExpectedOp = { op: "set", key: "contributes3a", value: false };
const delayMonths: ExpectedOp = { op: "shift", id: "ev-house", months: 6 };

const chipOps: Record<(typeof EXAMPLE_IDS)[number], ExpectedOp> = {
  jobLoss: { op: "add", type: "jobloss", duration: 6, month: july2028 },
  delay: { op: "shift", id: "ev-house", months: 24 },
  crash: { op: "add", type: "crash", month: 12 },
  baby: { op: "add", type: "child", month: july2028 },
  retire: { op: "set", key: "retirementAge", value: 60 },
  invest: monthly(500),
};

const intentCases: Record<Locale, IntentCase[]> = {
  en: [
    ["buy a flat for 1.2m in 2028", buy],
    ["Retire at 60", chipOps.retire],
  ],
  de: [
    ["1'200 pro Monat investieren", monthly(1200)],
    ["1’200 pro Monat investieren", monthly(1200)],
    ["500.– pro Monat investieren", monthly(500)],
    ["Auf Wachstum umstellen", profile],
    ["Ausgaben um 400 senken", spend],
    ["Säule 3a maximieren", start3a],
    ["Säule 3a starten", start3a],
    ["Säule 3a stoppen", stop3a],
    ["Wohnungskauf um 6 Monate verschieben", delayMonths],
    ["Im Jahr 2028 eine Wohnung für 1.200.000 kaufen", buy],
  ],
  fr: [
    ["Investir 1 200 par mois", monthly(1200)],
    ["Investir 1 200 par mois", monthly(1200)],
    ["Passer au profil croissance", profile],
    ["Réduire mes dépenses de 400", spend],
    ["Maximiser le pilier 3a", start3a],
    ["Commencer le pilier 3a", start3a],
    ["Arrêter le pilier 3a", stop3a],
    ["Reporter l’achat de 6 mois", delayMonths],
    ["Acheter un appartement à Lausanne pour 1,2 million en 2028", buy],
    ["Prendre ma retraite à 60 ans", chipOps.retire],
    ["Retraite anticipée à 60 ans", chipOps.retire],
    ["Partir a la retraite a 60 ans", chipOps.retire],
    ["J’investis 1'200 par mois", monthly(1200)],
    ["Investir 1’200 par mois", monthly(1200)],
    ["Investir 1.200 par mois", monthly(1200)],
    ["Placer 500.– par mois", monthly(500)],
    ["Investir Fr. 500 par mois", monthly(500)],
    ["Investir CHF 500 chaque mois", monthly(500)],
    ["Adopter une strategie dynamique", profile],
    ["Reduire mes depenses de 400", spend],
    ["Dépenser 400 de moins par mois", spend],
    ["J’économise 400 par mois", spend],
    ["Ouvrir un 3e pilier", start3a],
    ["Cotiser au 3a", start3a],
    ["Arreter le 3a", stop3a],
    ["Ne plus cotiser au 3e pilier", stop3a],
    ["Perdre mon emploi pendant 6 mois en 2028", chipOps.jobLoss],
    ["6 mois de chomage en 2028", chipOps.jobLoss],
    ["Krach boursier l'an prochain", chipOps.crash],
    ["Effondrement des marches l’annee prochaine", chipOps.crash],
    ["Avoir un bebe en 2028", chipOps.baby],
    ["Naissance d’un enfant en 2028", chipOps.baby],
    ["Decaler l'achat du logement de 6 mois", delayMonths],
    ["Repousser l’appartement de 2 ans", chipOps.delay],
    ["Acheter une maison pour 1,2 mio en 2028", buy],
    ["Acheter un logement a Geneve pour CHF 1'200'000 en 2028", buy],
  ],
  tr: [
    ["Ayda 500", monthly(500)],
    ["Ayda 1.200 yatırım yap", monthly(1200)],
    ["Büyüme profiline geç", profile],
    ["Harcamaları ayda 400 azalt", spend],
    ["3a’yı doldur", start3a],
    ["3a’ya başla", start3a],
    ["3a’yı durdur", stop3a],
    ["Ev alımını 6 ay ertele", delayMonths],
    ["2028'de 1,2 milyona ev satın al", buy],
  ],
};

function matches(ops: Op[] | null, expected: ExpectedOp) {
  if (ops?.length !== 1) return false;
  const [op] = ops;
  return Object.entries(expected).every(([key, value]) => Object.prototype.hasOwnProperty.call(op, key) && (op as unknown as Record<string, unknown>)[key] === value);
}

const percent: Record<Locale, string> = { en: "40%", de: "40%", fr: "40\u202f%", tr: "%40" };
const english = flatten(DICTIONARIES.en, []);
const expected = new Map([...english].map(([key, value]) => [key, placeholders(value, key, [])]));
let failures = 0;

for (const locale of LOCALES) {
  const errors: string[] = [];
  const same: string[] = [];
  const values = flatten(DICTIONARIES[locale], errors);
  for (const [key, tokens] of expected) {
    const value = values.get(key);
    if (value === undefined) {
      errors.push("Missing key " + key);
      continue;
    }
    if (tokens !== placeholders(value, key, errors)) errors.push(key + " must preserve placeholders: " + (tokens || "(none)"));
    if (locale === "de" && /[ßẞ]/.test(value)) errors.push(key + " contains an Eszett");
    if (locale !== "en" && value.length > 12 && !unchanged.has(key) && value === english.get(key)) same.push(key);
  }
  for (const key of values.keys()) if (!expected.has(key)) errors.push("Extra key " + key);

  const fmt = createFmt(locale);
  if (fmt.chf(1234) !== "CHF 1’234" || fmt.pct(0.4) !== percent[locale]) errors.push("CHF or percent formatting differs from the locale contract");

  const chips = commandExamples(locale);
  const parser = orderedParsers(locale)[0];
  let parsedChips = 0;
  for (const { id, text } of chips) {
    const native = validateLocalOps(parser.parse({ text, events, now, house: events.find((event) => event.type === "house") }), events);
    if (matches(native, chipOps[id]) && matches(localParseCommand(text, events, now, locale), chipOps[id])) parsedChips += 1;
    else errors.push("Example " + id + " does not produce the expected local intent: " + text + " → " + JSON.stringify(native));
  }
  for (const [text, op] of intentCases[locale]) {
    const result = localParseCommand(text, events, now, locale);
    if (!matches(result, op)) errors.push("Unexpected local intent for " + text + " → " + JSON.stringify(result));
  }
  for (const [text, op] of intentCases.en) {
    if (!matches(localParseCommand(text, events, now, locale), op)) errors.push("English fallback failed for " + text);
  }

  const untranslatedErrors = allowUntranslated ? 0 : same.length;
  failures += errors.length + untranslatedErrors;
  console.log(locale + ": " + values.size + " keys, " + parsedChips + "/" + chips.length + " chips parse locally, "
    + (errors.length + untranslatedErrors) + " errors" + (same.length ? ", " + same.length + " unchanged from English" + (allowUntranslated ? " (warning)" : "") : ""));
  for (const error of errors) console.error("  " + error);
  if (untranslatedErrors) {
    const shown = same.length <= 30 ? same : same.slice(0, 8);
    console.error("  Untranslated keys: " + shown.join(", ") + (shown.length < same.length ? ", …" : ""));
  }
}

if (failures) process.exitCode = 1;
