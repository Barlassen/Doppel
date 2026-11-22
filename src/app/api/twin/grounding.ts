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
 * The numbers in `answer` that are not allowed. A percentage also matches a fact stored as a share (0.42 ↔ 42%);
 * a negative fact matches its absolute value ("a gap of CHF 300" for -300).
 */
export function ungroundedNumbers(answer: string, allowed: readonly number[]): string[] {
  const pool = allowed.flatMap((n) => [n, Math.abs(n)]);
  return numbersIn(answer)
    .filter((found) => !found.values.some((value) => pool.some((ok) => near(value, ok) || (found.percent && Math.abs(ok) <= 1 && near(value, ok * 100)))))
    .map((found) => found.text);
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
