/**
 * Post-check for the `ask` task: the model may only quote figures the engine computed. Every number in the answer
 * has to be one of the allowed numbers (from the facts and the question); otherwise the answer is rejected.
 * Deterministic and server-side, so a model that does arithmetic or invents a figure cannot reach the user.
 */

const SEP = "'’‘`´\\u00a0\\u202f\\u2009 ";
const NUMBER = new RegExp(`\\d{1,3}(?:[${SEP}.,]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?`, "g");
/** "940k", "1.2 Mio", "1,2 million", "2 bin" (tr: thousand), "3 Mrd". */
const SCALE: readonly [RegExp, number][] = [
  [/^\s?(?:k|tsd\.?|tausend|mille|bin)(?![\p{L}\d])/iu, 1e3],
  [/^\s?(?:m|mio\.?|mill?ion(?:en|s|i)?|milyon)(?![\p{L}\d])/iu, 1e6],
  [/^\s?(?:mrd\.?|milliard(?:en|s|e)?|billion|milyar)(?![\p{L}\d])/iu, 1e9],
];
/**
 * Swiss terms that contain a digit but are names, not figures: pillar 2 / 3a / 3b ("Säule 3a", "2e pilier",
 * "3. sütun"), and list markers at the start of a line.
 */
const TERMS: readonly RegExp[] = [
  /(?:s[äa]ulen?|pillars?|piliers?|pilastro|s[üu]tun|ayak)\s*[123]\s?[ab]?(?![\p{L}\d])/giu,
  /(?<![\p{L}\d.,])[123]\s?(?:\.|e|er|ème|eme|re|nd|rd|st|th|°|\.\s?ayak)?\s*(?:s[äa]ulen?|pillars?|piliers?|pilastro|s[üu]tun)/giu,
  /(?<![\p{L}\d.,])3\s?[ab](?![\p{L}\d])/giu,
  /^\s*\d{1,2}[.)]\s+(?=\p{L})/gmu,
];

/** Every value a printed number can mean: "1.200" is 1200 (grouping) or 1.2, "1'234,50" is 1234.5. */
function readings(token: string): number[] {
  const compact = token.replace(new RegExp(`[${SEP}]`, "g"), "");
  const forms = new Set<string>();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(compact)) forms.add(compact.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(compact)) forms.add(compact.replace(/,/g, ""));
  if (/^\d+(?:[.,]\d+)?$/.test(compact)) forms.add(compact.replace(",", "."));
  return [...forms].map(Number).filter((n) => Number.isFinite(n));
}

export interface FoundNumber { text: string; values: number[]; percent: boolean }

export function numbersIn(text: string): FoundNumber[] {
  let clean = text;
  for (const term of TERMS) clean = clean.replace(term, (match) => " ".repeat(match.length));
  const found: FoundNumber[] = [];
  for (const match of clean.matchAll(NUMBER)) {
    const token = match[0];
    const after = clean.slice(match.index + match[0].length);
    const before = clean.slice(0, match.index);
    const scale = SCALE.find(([re]) => re.test(after))?.[1] ?? 1;
    const base = readings(token);
    const values = scale === 1 ? base : [...base.map((n) => n * scale), ...base];
    // Turkish writes the sign first (%40).
    found.push({ text: token, values, percent: /^\s?%/.test(after) || /%\s?$/.test(before) });
  }
  return found;
}

// ---------------- numbers written as words ----------------

/** Cardinals in the four languages. "one / ein / un / bir" are left out: they are articles far more often. */
const WORD_UNITS: Readonly<Record<string, number>> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
  zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, dreizehn: 13,
  vierzehn: 14, fünfzehn: 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, dreissig: 30, dreißig: 30,
  vierzig: 40, fünfzig: 50, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90,
  deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, septante: 70, huitante: 80, octante: 80, nonante: 90,
  iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, yirmi: 20, otuz: 30, kırk: 40, elli: 50, altmış: 60, yetmiş: 70,
  seksen: 80, doksan: 90,
};
const WORD_MULTIPLIERS: Readonly<Record<string, number>> = {
  hundred: 100, thousand: 1e3, million: 1e6, millions: 1e6, billion: 1e9, hundert: 100, tausend: 1e3, millionen: 1e6, milliarde: 1e9, milliarden: 1e9,
  cent: 100, cents: 100, mille: 1e3, milliard: 1e9, milliards: 1e9, yüz: 100, bin: 1e3, milyon: 1e6, milyar: 1e9,
};
const CONNECTORS = new Set(["and", "und", "et", "ve"]);
/** German writes numbers as one word ("fünfundzwanzigtausend"): its parts, longest first. */
const GERMAN_PARTS = ["hundert", "tausend", "und", "eine", "ein", ...Object.keys(WORD_UNITS).filter((w) => /^(?:zw|dr|vi|f[uü]|se|si|ac|ne|ze|el)/.test(w))].sort((a, b) => b.length - a.length);
const GERMAN_COMPOUND = new RegExp(`^(?:${GERMAN_PARTS.join("|")}){2,}$`);
const GERMAN_PART = new RegExp(GERMAN_PARTS.join("|"), "g");

/** A word as number parts: itself when it is a number word, its parts for a German compound, else nothing. */
function numberParts(word: string): string[] {
  if (word in WORD_UNITS || word in WORD_MULTIPLIERS) return [word];
  if (GERMAN_COMPOUND.test(word)) {
    const parts = word.match(GERMAN_PART) ?? [];
    if (parts.some((part) => part in WORD_UNITS || part in WORD_MULTIPLIERS)) return parts.filter((part) => part !== "und");
  }
  return [];
}

/**
 * Numbers spelled out ("twenty thousand", "zwanzigtausend", "vingt mille", "yirmi bin"). A small count without a
 * multiplier (two … twelve: "two options", "in drei Schritten") is ordinary prose and is not reported (unless
 * `includeSmall`); everything else is a figure and has to be grounded like a printed number.
 */
export function spelledNumbers(text: string, includeSmall = false): FoundNumber[] {
  // "İ" lower-cases to "i" plus a combining dot.
  const lower = text.toLowerCase().replace(/i\u0307/g, "i");
  // Swiss and French "quatre-vingt(s)" is one tens word.
  const clean = lower.replace(/quatre[-\s]vingts?/g, "huitante");
  const words = [...clean.matchAll(/[\p{L}]+/gu)].map((m) => ({ word: m[0], index: m.index, end: m.index + m[0].length }));
  const found: FoundNumber[] = [];
  for (let i = 0; i < words.length; i++) {
    let parts = numberParts(words[i].word);
    if (!parts.length) continue;
    // "1.2 million", "940 bin": the scale of a printed number, already read by numbersIn().
    if (/\d[\d.,'’\u00a0\u202f ]*$/.test(clean.slice(0, words[i].index)) && parts.every((part) => part in WORD_MULTIPLIERS)) continue;
    // "pour cent" is the percent sign, "yüzde" never reaches here (it is another word).
    if (words[i].word === "cent" && i > 0 && words[i - 1].word === "pour") continue;
    const start = i;
    let j = i + 1;
    for (; j < words.length; j++) {
      const gap = clean.slice(words[j - 1].end, words[j].index);
      if (!/^[\s-]+$/.test(gap)) break;
      const next = numberParts(words[j].word);
      if (next.length) parts = parts.concat(next);
      else if (CONNECTORS.has(words[j].word) && j + 1 < words.length && numberParts(words[j + 1].word).length) continue;
      else break;
    }
    i = j - 1;
    let total = 0;
    let current = 0;
    let scaled = false;
    for (const part of parts) {
      if (part === "ein" || part === "eine") current += 1;
      else if (part in WORD_UNITS) current += WORD_UNITS[part];
      else {
        const m = WORD_MULTIPLIERS[part];
        scaled = true;
        if (m === 100) current = (current || 1) * 100;
        else {
          total += (current || 1) * m;
          current = 0;
        }
      }
    }
    const value = total + current;
    if (!includeSmall && !scaled && value < 13) continue;
    const after = clean.slice(words[j - 1].end);
    const before = clean.slice(0, words[start].index);
    found.push({ text: clean.slice(words[start].index, words[j - 1].end), values: [value], percent: /^\s?(?:%|percent|prozent|pour\s?cent)/.test(after) || /(?:%|yüzde)\s?$/.test(before) });
  }
  return found;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.005 + Math.abs(b) * 1e-9;

/** Numbers a fact value carries: the number itself, or every number printed in a string. */
export function allowedNumbers(...sources: unknown[]): number[] {
  const out: number[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
    else if (typeof value === "string") for (const found of numbersIn(value)) out.push(...found.values);
    else if (value && typeof value === "object") for (const nested of Object.values(value)) visit(nested);
  };
  sources.forEach(visit);
  return out;
}

/**
 * The numbers in `answer` that are not allowed, printed or spelled out. A percentage also matches a fact stored as a
 * share (0.42 ↔ 42%); a negative fact matches its absolute value ("a gap of CHF 300" for -300).
 */
export function ungroundedNumbers(answer: string, allowed: readonly number[]): string[] {
  const pool = allowed.flatMap((n) => [n, Math.abs(n)]);
  return [...numbersIn(answer), ...spelledNumbers(answer)]
    .filter((found) => !found.values.some((value) => pool.some((ok) => near(value, ok) || (found.percent && Math.abs(ok) <= 1 && near(value, ok * 100)))))
    .map((found) => found.text);
}

// ---------------- the time basis of a figure ----------------

const edge = (words: string) => new RegExp(`(?<![\\p{L}])(?:${words})(?![\\p{L}])`, "iu");
const RATE_YEAR = edge("per year|a year|yearly|annual(?:ly)?|each year|every year|per annum|jährlich|jaehrlich|pro jahr|im jahr|par an|annuel\\p{L}*|chaque année|yılda|yıllık|senede|senelik|her yıl|her sene");
const RATE_MONTH = edge("per month|a month|monthly|each month|every month|monatlich|pro monat|im monat|par mois|mensuel\\p{L}*|chaque mois|ayda|aylık|her ay");
const TOTAL = edge("total|in all|altogether|overall|sum|by (?:the|your) goal(?: date)?|by 20\\d\\d|until|up to|over the (?:whole|entire|full)|insgesamt|gesamthaft|total|bis zum|bis \\d{4}|au total|en tout|d'ici|jusqu\\p{L}*|toplam\\p{L}*|tarihine kadar|hedefe kadar|boyunca");

/**
 * A figure quoted on another time basis than its key states: a total (`…_by_goal_date_…`, `…_total_…`) called a
 * yearly or monthly amount, or a monthly amount (`…_per_month_…`) called a yearly one. Checked per sentence; a
 * sentence that also names the right basis ("in total by the goal date", "per month") passes. Returns the figures
 * that are mislabelled. The number check cannot see this: the number itself is one of the engine's.
 */
export function basisMismatches(answer: string, facts: Readonly<Record<string, unknown>>): string[] {
  const basis = new Map<number, Set<"total" | "month" | "other">>();
  for (const [key, value] of Object.entries(facts)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value === 0) continue;
    const kind = /_by_goal_date_|_total_/.test(key) ? "total" : /_per_month_/.test(key) ? "month" : "other";
    const v = Math.abs(value);
    basis.set(v, (basis.get(v) ?? new Set()).add(kind));
  }
  const out: string[] = [];
  for (const sentence of answer.split(/(?<=[.!?])\s+|\n+/)) {
    const yearly = RATE_YEAR.test(sentence);
    const monthly = RATE_MONTH.test(sentence);
    if (!yearly && !monthly) continue;
    const total = TOTAL.test(sentence);
    for (const found of numbersIn(sentence)) {
      const kinds = [...basis.entries()].find(([v]) => found.values.some((x) => near(x, v)))?.[1];
      if (!kinds || kinds.has("other")) continue;
      const totalOk = kinds.has("total") && total;
      const monthOk = kinds.has("month") && monthly && !(yearly && !monthly);
      if (!totalOk && !monthOk) out.push(found.text);
    }
  }
  return out;
}

/** Cuts an answer to `limit` words at the last sentence end inside the limit. */
export function limitWords(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean.split(" ");
  if (words.length <= limit) return clean;
  const cut = words.slice(0, limit).join(" ");
  if (/[.!?]$/.test(cut)) return cut;
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > cut.length / 2 ? cut.slice(0, end + 1) : cut + "…";
}
