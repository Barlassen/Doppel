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
    ["Mit 60 pensioniert werden", chipOps.retire],
    ["Frühpensionierung mit 62", { op: "set", key: "retirementAge", value: 62 }],
    ["Was, wenn ich mit 63 Jahren vorzeitig in Pension gehe?", { op: "set", key: "retirementAge", value: 63 }],
    ["Mit 61 lasse ich mich pensionieren", { op: "set", key: "retirementAge", value: 61 }],
    ["Ab 64 aufhören zu arbeiten", { op: "set", key: "retirementAge", value: 64 }],
    ["Ich möchte monatlich 1 200 Franken anlegen", monthly(1200)],
    ["Jeden Monat 1.200 in Fonds stecken", monthly(1200)],
    ["Investiere Fr. 500 pro Monat", monthly(500)],
    ["Monatlich lege ich CHF 500 an", monthly(500)],
    ["Einen Dauerauftrag über 500.– einrichten", monthly(500)],
    ["500 Franken je Monat in ETFs stecken", monthly(500)],
    ["Vom defensiven auf das Wachstumsprofil wechseln", profile],
    ["Das Portfolio auf eine ausgewogene Strategie umstellen", { op: "set", key: "riskProfile", value: "balanced" }],
    ["Beim Anlegen auf Sicherheit setzen", { op: "set", key: "riskProfile", value: "conservative" }],
    ["Ich möchte mehr Aktien im Portfolio", profile],
    ["Die Fixkosten monatlich um Fr. 400 kürzen", spend],
    ["Was, wenn ich jeden Monat CHF 400 weniger ausgebe?", spend],
    ["Pro Monat 400 Franken einsparen", spend],
    ["Den Höchstbetrag in die Säule 3a einzahlen", start3a],
    ["Jetzt fange ich mit der dritten Säule an", start3a],
    ["Ich will die Säule 3a voll ausschöpfen", start3a],
    ["Die Einzahlungen in die Säule 3a sistieren", stop3a],
    ["Nicht mehr in die Säule 3a einzahlen", stop3a],
    ["Was, wenn ich 2028 für 6 Monate meine Stelle verliere?", chipOps.jobLoss],
    ["2028 bin ich 8 Monate lang stellenlos", { op: "add", type: "jobloss", duration: 8, month: july2028 }],
    ["In 3 Monaten werde ich für 8 Monate entlassen", { op: "add", type: "jobloss", duration: 8, month: 3 }],
    ["In 3 Monaten verliere ich meine Stelle", { op: "add", type: "jobloss", duration: 6, month: 3 }],
    ["Was, wenn die Börse im nächsten Jahr einbricht?", chipOps.crash],
    ["Nächstes Jahr brechen die Märkte ein", chipOps.crash],
    ["Die Aktienkurse stürzen im kommenden Jahr ab", chipOps.crash],
    ["Wir erwarten 2028 Nachwuchs", chipOps.baby],
    ["2028 werden wir Eltern", chipOps.baby],
    ["Die Geburt unseres Kindes ist für 2028 geplant", chipOps.baby],
    ["Mit dem Hauskauf noch 6 Monate zuwarten", delayMonths],
    ["Den Eigenheimkauf um 2 Jahre nach hinten schieben", chipOps.delay],
    ["Den Kauf der Wohnung um 6 Monate hinausschieben", delayMonths],
    ["2028 eine Wohnung in Bern für CHF 1,2 Mio. kaufen", buy],
    ["Ich möchte 2028 ein Haus für Fr. 1.2 Mio kaufen", buy],
    ["Für 1’200’000 Franken ein Eigenheim im Jahr 2028 erwerben", buy],
    ["Eine Liegenschaft 2028 für 1 200 000 kaufen", buy],
    ["2028 eine Wohnung zum Kaufpreis von 1,2 Mio. erwerben, mein Budget ist 1,5 Mio.", buy],
    ["Ich zahle jeden Monat CHF 500 in einen ETF ein", monthly(500)],
    ["Schiebe den Wohnungskauf um 6 Monate auf", delayMonths],
    ["2028 gibt es Familienzuwachs", chipOps.baby],
    ["Fr. 500 pro Mt. anlegen", monthly(500)],
    ["Für 2028 eine Wohnung in St. Gallen für CHF 1,2 Mio. kaufen", { ...buy, label: "Home in St. Gallen" }],
    ["Saeule 3a voll einzahlen", start3a],
    ["3a-Einzahlungen aussetzen", stop3a],
    ["Fruehpensionierung mit 62", { op: "set", key: "retirementAge", value: 62 }],
    ["Mit sechzig pensioniert werden", chipOps.retire],
    ["Im Alter von 62 in den Ruhestand", { op: "set", key: "retirementAge", value: 62 }],
    ["Ich arbeite nur noch bis 62", { op: "set", key: "retirementAge", value: 62 }],
    ["Was wenn ich mit 55 aufhöre zu arbeiten", { op: "set", key: "retirementAge", value: 55 }],
    ["Jeden Monat 700 Stutz anlegen", monthly(700)],
    ["Fr. 1’200.– pro Monat in einen Sparplan", monthly(1200)],
    ["Monatlich 1 500 Franken in Aktien stecken", monthly(1500)],
    ["Ich moechte monatlich 800 Franken investieren", monthly(800)],
    ["Ich gebe 250 mehr aus pro Monat", { op: "set", key: "expenseDelta", value: 250 }],
    ["Ich gebe monatlich 400 Fr. weniger aus", spend],
    ["Kostenreduktion von CHF 400 im Monat", spend],
    ["Die Miete um 400 Franken pro Monat senken", spend],
    ["Risiko erhöhen", profile],
    ["Ich will weniger Risiko eingehen", { op: "set", key: "riskProfile", value: "conservative" }],
    ["Kauf der Liegenschaft um ein Jahr verschieben", { op: "shift", id: "ev-house", months: 12 }],
    ["Den Hauskauf um ein halbes Jahr verschieben", delayMonths],
    ["Hauskauf auf 2030 verschieben", { op: "shift", id: "ev-house", months: 30 }],
    ["Wohnungskauf 2 Jahre früher", { op: "shift", id: "ev-house", months: -24 }],
    ["Stockwerkeigentum in Basel für CHF 1'200'000 kaufen im 2028", buy],
    ["Haus für eine Million kaufen im Jahr 2029", { op: "add", type: "house", amount: 1_000_000, month: 42 }],
    ["Ich verliere in drei Monaten meine Stelle für ein halbes Jahr", { op: "add", type: "jobloss", duration: 6, month: 3 }],
    ["Ein Jahr ohne Job ab 2028", { op: "add", type: "jobloss", duration: 12, month: july2028 }],
    ["Boerse bricht naechstes Jahr ein", chipOps.crash],
    ["Wenn die Aktienkurse 2028 um 30% fallen", { op: "add", type: "crash", month: july2028 }],
    ["In einem Jahr kommt unser zweites Kind", { op: "add", type: "child", month: 12 }],
    ["500 mehr Lohn pro Monat ab 2027", { op: "add", type: "raise", amount: 500, month: 18 }],
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
    ["60'ta emekli olsam", chipOps.retire],
    ["60’ta emekli olsam", chipOps.retire],
    ["emekli olmak istiyorum 60 yasinda", chipOps.retire],
    ["altmış yaşında emekli olalım", chipOps.retire],
    ["Erken emeklilik 62", { op: "set", key: "retirementAge", value: 62 }],
    ["aylık 500 CHF yatırım", monthly(500)],
    ["Her ay 1’200 frank yatırsam", monthly(1200)],
    ["500'ü her ay yatırın", monthly(500)],
    ["Ayda 500.– biriktir", monthly(500)],
    ["Agresif portföye geç", profile],
    ["Daha az riskli olsun", { op: "set", key: "riskProfile", value: "conservative" }],
    ["dengeli yatirim yap", { op: "set", key: "riskProfile", value: "balanced" }],
    ["harcamalari 400 azalt", spend],
    ["Ayda 400 daha az harca", spend],
    ["Harcamalarımı ayda 400 frank kısalım", spend],
    ["3a’yı maksimuma çıkar", start3a],
    ["3ayi durdur", stop3a],
    ["Bireysel emekliliği bırak", stop3a],
    ["2028’de altı ay işsiz kalırsam ne olur?", chipOps.jobLoss],
    ["2028de 6 ay issiz kalirsam", chipOps.jobLoss],
    ["İŞİMİ KAYBEDERSEM 2028'DE 6 AY", chipOps.jobLoss],
    ["Seneye borsa çökerse", chipOps.crash],
    ["gelecek yil piyasalar %30 duserse", chipOps.crash],
    ["2028’de bebeğimiz olursa", chipOps.baby],
    ["2028de cocugumuz olursa", chipOps.baby],
    ["Ev alımını 2 yıl ertele", chipOps.delay],
    ["daireyi yarım yıl ötele", delayMonths],
    ["Ev alımını 1 yıl öne çek", { op: "shift", id: "ev-house", months: -12 }],
    ["2028’de 1.2 mio'ya daire satın almak istiyorum", buy],
    ["2028de 1’200’000 CHF'lik konut alsak", buy],
    ["2028'de 1,2 milyon franka daire al", buy],
    ["2028'de işten atılırsam", chipOps.jobLoss],
    ["2028de isimi kaybedersem 8 ayligina", { op: "add", type: "jobloss", duration: 8, month: july2028 }],
    ["3 ay sonra 8 ay işsiz kalsam", { op: "add", type: "jobloss", duration: 8, month: 3 }],
    ["3 ay sonra işi bıraksam", { op: "add", type: "jobloss", duration: 6, month: 3 }],
    ["2028'de çocuk yapsak", chipOps.baby],
    ["2028'de ebeveyn olsak", chipOps.baby],
    ["emekliliği 3 yıl öne çeksem", { op: "set", key: "retirementAge", value: 62 }],
    ["emekliligi 2 yil ertelesem", { op: "set", key: "retirementAge", value: 67 }],
    ["62 yaşında Pensionskasse'den emekli olsam", { op: "set", key: "retirementAge", value: 62 }],
    ["Pensionskasse ile 60 yaşında erken emeklilik", chipOps.retire],
    ["64 yaşında çalışmayı bıraksam", { op: "set", key: "retirementAge", value: 64 }],
    ["3a'ya tavandan ödeme yapsam", start3a],
    ["Säule 3a'ya her ay maksimum yatırsam", start3a],
    ["3a'yı fullesem", start3a],
    ["3a'ya artık para yatırmasam", stop3a],
    ["Ayda 1'200 CHF ETF'e yatırsam", monthly(1200)],
    ["Her ay fona 1.200 frank koysam", monthly(1200)],
    ["Aylık 500.– Dauerauftrag kursam", monthly(500)],
    ["Boştaki nakdi değerlendirsem", { op: "set", key: "optimize", value: true }],
    ["Sabit giderlerden ayda 400.– kıssam", spend],
    ["Evi 6 ay daha geç alsam", delayMonths],
    ["2028'de St. Gallen'de 1,2 milyona daire alsak", { ...buy, label: "Home in St. Gallen" }],
    ["2028de 1.200.000 chfye ev alsam", buy],
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
  // Relative retirement shifts start from the plan's age, not the statutory 65.
  if (locale === "tr" && !matches(localParseCommand("emekliliği 3 yıl öne çeksem", events, now, "tr", 58), { op: "set", key: "retirementAge", value: 55 })) {
    errors.push("Relative retirement shift ignores the plan's retirement age");
  }
  let parsedChips = 0;
  for (const { id, text } of chips) {
    const native = validateLocalOps(parser.parse({ text, events, now, retirementAge: 65, house: events.find((event) => event.type === "house") }), events);
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
