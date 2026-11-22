import { translateText } from "@/lib/i18n";
import { msg, type Msg } from "@/lib/i18n/types";
import type { DocKind, Extraction } from "./types";
import { hasReceiptTotal, parseReceipt } from "./receipt";

/**
 * Local deterministic document classifier + regex extractor.
 * Used as:
 *   1. Fast 0-token Tier-1 path when OCR confidence is high and structure is unambiguous.
 *   2. Offline fallback when no API key is configured.
 * Supports German, French, and English Swiss financial documents.
 */

// Include ° / ´ / ‘ because Tesseract occasionally reads Swiss apostrophe thousands separators (795'000) as 795°000.
const THOUS_SEP = "['’‘`´°\\u202f\\u00a0 ]";
// Dots group thousands only where nothing else can be meant: before a decimal comma ("1.234,50"), before ".–"
// ("1.250.–"), or with two or more groups ("1.250.000").
const DOT_THOUSANDS = "\\d{1,3}(?:\\.\\d{3})+(?=,\\d{2}(?!\\d)|\\.[-–—])|\\d{1,3}(?:\\.\\d{3}){2,}(?![\\d])";
const AMOUNT_RE = new RegExp(
  `(?:^|[^\\d.,])(${DOT_THOUSANDS}|\\d{1,3}(?:${THOUS_SEP}\\d{3})+|\\d+)(?:[.,](\\d{2}|[-–—]))?(?=$|[^\\d])`,
  "g",
);
const SEPARATORS = /['’‘`´°\u202f\u00a0 ]/g;
const DAY_MONTH = "(?:0?[1-9]|[12]\\d|3[01])\\.(?:0?[1-9]|1[0-2])\\.";

/** Parse all plausible monetary amounts on a line (skipping percentages and dates). */
function extractAmountsFromLine(line: string): number[] {
  // Strip dates (DD.MM.YYYY, DD/MM/YY, YYYY-MM-DD), percentages (5.30 %), and IBAN/AHV numbers.
  const cleaned = line
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, " ")
    // "zahlbar bis 31.12." has no year; it is still a date, not CHF 31.12.
    .replace(new RegExp(`(?<![\\d.,])${DAY_MONTH}(?![\\d–—-])`, "g"), " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b756[.\s]?\d{4}[.\s]?\d{4}[.\s]?\d{2}\b/g, " ")
    .replace(/\bCH\d{2}[\s\d]{16,24}\b/gi, " ")
    .replace(/\d+(?:[.,]\d+)?\s*%/g, " ")
    .replace(/CHF|Fr\.|SFR/gi, " ");

  const results: number[] = [];
  for (const m of cleaned.matchAll(AMOUNT_RE)) {
    const grouped = m[1].replace(SEPARATORS, "");
    const intPart = /^\d{1,3}(?:\.\d{3})+$/.test(grouped) ? grouped.replace(/\./g, "") : grouped;
    const decPart = m[2] && /^\d{2}$/.test(m[2]) ? `.${m[2]}` : "";
    const n = Number(intPart + decPart);
    if (Number.isFinite(n) && n > 0) results.push(n);
  }
  return results;
}

const CURRENCY_NUMBER = "[+-]?(?:\\d{1,3}(?:['’‘`´°\\u202f\\u00a0 ,.]\\d{3})+|\\d+)(?:[.,](?:\\d{2}(?!\\d)|[-–—]))?";
const AFTER_CURRENCY = new RegExp(`(?:CHF|SFR|Fr\\.?)\\s*(${CURRENCY_NUMBER})`, "i");
const BEFORE_CURRENCY = new RegExp(`(?<![\\d.,])(${CURRENCY_NUMBER})\\s*(?:CHF|SFR|Fr\\.)(?![\\p{L}])`, "iu");

/** The amount printed next to the currency ("CHF 1'234.50", "1.234,50 CHF", "CHF 1.250.000.–"), if any. */
export function currencyAmount(s: string): number | undefined {
  const raw = (AFTER_CURRENCY.exec(s) ?? BEFORE_CURRENCY.exec(s))?.[1];
  if (!raw) return undefined;
  const decimals = /[.,](\d{2}|[-–—])$/.exec(raw);
  const whole = (decimals ? raw.slice(0, decimals.index) : raw).replace(SEPARATORS, "").replace(/^[+-]/, "");
  // A comma or dot inside the whole part groups thousands (it is followed by exactly three digits).
  if (!/^\d+(?:[.,]\d{3})*$/.test(whole)) return undefined;
  const n = Number(whole.replace(/[.,]/g, "") + (decimals && /^\d{2}$/.test(decimals[1]) ? `.${decimals[1]}` : ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Parse a single CHF-formatted number from text (supports Swiss apostrophe, spaces, comma decimals). */
function parseChf(s: string): number | undefined {
  // Prefer the number printed next to the currency.
  const withCur = currencyAmount(s);
  if (withCur !== undefined) return withCur;
  const vals = extractAmountsFromLine(s);
  return vals.length > 0 ? vals[vals.length - 1] : undefined;
}

/** Parse a year between 2020 and 2069, tolerating common OCR artifacts like "202.8", "202 8", or "2O28". */
function parseYearWithNoise(text: string): number | undefined {
  const clean = text.match(/\b(20[2-6]\d)\b/);
  if (clean) return Number(clean[1]);
  // Tolerate stray punctuation/space before the final digit or O/0 confusion (e.g. "202.8", "202,8", "202 8", "2O28").
  const noisy = text.match(/\b2[0Oo]([2-6])[.,'\s-]?([0-9])\b/);
  if (noisy) return Number(`20${noisy[1]}${noisy[2]}`);
  return undefined;
}

/** Score each document kind by weighted German / French / English keyword cues. */
export function scoreDocKinds(text: string): Record<DocKind, number> {
  const lower = text.toLowerCase();
  const scores: Record<DocKind, number> = {
    payslip: 0,
    listing: 0,
    receipt: 0,
    bill: 0,
    note: 0,
    other: 0,
  };

  const add = (kind: DocKind, patterns: [RegExp, number][]) => {
    for (const [re, w] of patterns) {
      if (re.test(lower)) scores[kind] += w;
    }
  };

  add("payslip", [
    [/lohnabrechnung/, 5],
    [/nettolohn/, 5],
    [/auszahlung(?:sbetrag)?/, 4],
    [/bruttolohn|monatslohn/, 4],
    [/fiche\s+de\s+paie|bulletin\s+de\s+salaire|d[ée]compte\s+de\s+salaire/, 5],
    [/salaire\s+net/, 5],
    [/salaire\s+brut/, 4],
    [/\bpayslip\b|net\s+pay|net\s+salary/, 5],
    [/\bahv\b|\bavs\b/, 2],
    [/\balv\b|\bbvg\b|\bnbu\b|\blpp\b/, 2],
    [/pensionskasse|abz[üu]ge|cotisations|sozialabz/, 2],
    [/\blohn\b|\bsalary\b|\bsalaire\b/, 1],
  ]);

  add("listing", [
    [/kaufpreis|verkaufspreis/, 5],
    [/prix\s+de\s+vente/, 5],
    [/\bzimmer\b|zi\./, 3],
    [/\bpi[èée]ces?\b/, 3],
    [/wohnung|eigentumswohnung|einfamilienhaus|eigentum/, 3],
    [/appartement|surface\s+habitable|[àa]\s+vendre/, 3],
    [/wohnfl[äa]che|baujahr|bezugsbereit|zu\s+verkaufen/, 3],
    [/\bfor\s+sale\b|\bapartment\b|asking\s+price|\brooms?\b/, 2],
    [/\bm[²2]\b/, 2],
    [/immobilien|immobilier|immolake|homegate|flatfox|comparis/, 2],
  ]);

  add("receipt", [
    [/total\s+ttc|montant\s+ttc/, 5],
    [/\bquittung\b|\bkassenbon\b|\bticket\s+de\s+caisse\b|\breceipt\b/, 4],
    [/\bscontrino\b|\bricevuta\s+fiscale\b/, 4],
    [/\bmwst\b|\btva\b|\bvat\b/, 3],
    [/\bkasse\b|\bcaisse\b/, 3],
    [/einkauf|merci\s+f[üu]r|merci\s+de\s+votre/, 3],
    [/total\s+chf|gesamtsumme|gesamtbetrag|zu\s+zahlen/, 3],
    [/karte|debit|twint|ec-direct|esp[èe]ces|\bbar\b/, 2],
    [/\b(total|summe)\b/, 1],
    [/markt|supermarkt|boulangerie|b[äa]ckerei|coop|migros|denner/, 2],
  ]);

  add("bill", [
    [/zahlteil|empfangsschein/, 5],
    [/section\s+paiement|r[ée]c[ée]piss[ée]/, 5],
    [/zahlbar\s+an|payable\s+[àa]/, 4],
    [/\brechnung\b|\bfacture\b|\binvoice\b/, 3],
    [/rechnungs?[- ]?(?:nr|nummer|datum|betrag)|rechnung\s+nr|invoice\s+(?:no|number|date)|facture\s+n[°o]|n[°o]\s+de\s+facture/, 3],
    [/rechnungsbetrag|montant\s+(?:total|d[ûu]|[àa]\s+payer)|amount\s+due/, 2],
    [/zahlbar\s+(?:bis|innert)|f[äa]llig\s+am|payable\s+(?:jusqu|dans|by|within)|[ée]ch[ée]ance|due\s+date|zahlungsfrist/, 3],
    [/pr[äa]mie|krankenkasse|assurance\s+maladie/, 2],
    [/\biban\b|ch\d{2}\s?\d{4}/, 2],
  ]);

  add("note", [
    [/\b\d+(?:[.,]\d+)?\s*k\b/, 3],
    [/[≈~]/, 2],
    [/sabbatical|goal|budget|sparen|ferien|vacances|wedding|hochzeit|need\b/, 2],
  ]);

  return scores;
}

/** Cheap keyword-scoring document classifier (DE / FR / EN). */
export function classifyDoc(text: string): DocKind {
  const scores = scoreDocKinds(text);
  const candidates: DocKind[] = ["payslip", "listing", "receipt", "bill", "note"];
  let best: DocKind = "note";
  let bestScore = 0;
  for (const k of candidates) {
    if (scores[k] > bestScore) {
      best = k;
      bestScore = scores[k];
    }
  }
  if (bestScore < 2 && hasReceiptTotal(text)) return "receipt";
  return bestScore >= 2 ? best : "note";
}

function parseDate(text: string): string | undefined {
  // The first date that exists in the calendar: "31.02.2026" is an OCR slip, not a date.
  const real = (year: string, month: string, day: string) => {
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : undefined;
  };
  for (const m of text.matchAll(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g)) {
    const date = real(m[1], m[2], m[3]);
    if (date) return date;
  }
  for (const m of text.matchAll(/\b(0?[1-9]|[12]\d|3[01])[./](0?[1-9]|1[0-2])[./](\d{4}|\d{2})\b/g)) {
    const date = real(m[3].length === 2 ? `20${m[3]}` : m[3], m[2], m[1]);
    if (date) return date;
  }
  return undefined;
}

function generatedLabel(labelMsg: Msg) {
  return { label: translateText("en", labelMsg), labelMsg };
}

function extractListing(t: string, lower: string): Extraction {
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  let amount: number | undefined;

  // 1. Line mentioning price / CHF with a large number (≥ 50k)
  for (const l of lines) {
    if (/chf|kaufpreis|verkaufspreis|prix\s+de\s+vente|prix|preis|price/i.test(l)) {
      const vals = extractAmountsFromLine(l).filter((v) => v >= 50_000 && v <= 50_000_000);
      if (vals.length > 0) {
        amount = vals[0];
        break;
      }
      const p = parseChf(l);
      if (p && p >= 50_000 && p <= 50_000_000) {
        amount = p;
        break;
      }
    }
  }
  // 2. Fallback: look for the largest plausible Swiss property price across all lines
  if (amount == null) {
    const allPrices = lines
      .flatMap((l) => extractAmountsFromLine(l))
      .filter((v) => v >= 100_000 && v <= 50_000_000);
    if (allPrices.length > 0) amount = Math.max(...allPrices);
  }

  const rooms = lower.match(/(\d(?:[.,]5)?)\s*(?:-?\s*(?:zimmer|pi[èée]ces?|rooms?|zi\.|pcs?))/);
  const loc = t.match(/\b([1-9]\d{3})\s+([A-ZÄÖÜÀÂÉÈÊËÎÏÔÙÛÇ][\wÀ-ÿ-]+(?:[- ][A-ZÄÖÜÀÂÉÈÊËÎÏÔÙÛÇ][\wÀ-ÿ-]+)?)/);

  return {
    kind: "listing",
    amount,
    rooms: rooms ? Number(rooms[1].replace(",", ".")) : undefined,
    location: loc ? loc[2] : undefined,
    ...generatedLabel(loc ? msg("event.homeIn", { place: loc[2] }) : msg("summary.listingFallback")),
  };
}

function extractPayslip(t: string): Extraction {
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const netRe =
    /(nettolohn|auszahlungsbetrag|auszahlung|nettobetrag|salaire\s+net|net\s+[àa]\s+payer|net\s+pay|net\s+salary|\bnetto\b)/i;
  const excludeRe = /(brutto|salaire\s+brut|gross|total\s+abz[üu]g|abz[üu]g|deduct|cotisation)/i;

  let amount: number | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (!netRe.test(l) || excludeRe.test(l)) continue;
    const vals = extractAmountsFromLine(l).filter((v) => v >= 500 && v <= 100_000);
    if (vals.length > 0) {
      amount = vals[vals.length - 1];
      break;
    }
    // Sometimes OCR wraps the Nettolohn amount onto the next line
    const next = lines[i + 1];
    if (next && !excludeRe.test(next)) {
      const nextVals = extractAmountsFromLine(next).filter((v) => v >= 500 && v <= 100_000);
      if (nextVals.length > 0) {
        amount = nextVals[nextVals.length - 1];
        break;
      }
    }
  }

  // Extract employer from top line that looks like a company name (not the title "Lohnabrechnung")
  const merchant = lines.find(
    (l) =>
      /[A-Za-zÀ-ÿ]{3}/.test(l) &&
      !/^(lohnabrechnung|fiche\s+de\s+paie|bulletin\s+de\s+salaire|payslip|monat|periode|p[ée]riode)/i.test(l),
  );

  return {
    kind: "payslip",
    amount,
    merchant: merchant?.slice(0, 48),
    date: parseDate(t),
    ...generatedLabel(msg("kind.payslip")),
  };
}

const BILL_TOTAL = /(?:rechnungs(?:betrag|total)|gesamt(?:betrag|total|summe)|total(?:betrag)?|endbetrag|zu\s+(?:be)?zahlen|zahlbar|betrag\s+f[äa]llig|montant\s+(?:total|d[ûu]|[àa]\s+payer)|[àa]\s+payer|total\s+ttc|amount\s+(?:due|payable)|balance\s+due|importo\s+totale|da\s+pagare)/i;
const BILL_PARTIAL = /(?:zwischen[\s-]?(?:total|summe)|sub[\s-]?total|sous[\s-]?total|netto|net\b|\bht\b|exkl|excl|mwst|tva|\bvat\b|\biva\b|rabatt|skonto|remise|discount|anzahlung|acompte|bereits\s+bezahlt)/i;

/** One line's amount: the number next to the currency, else the last number with decimals, else the last number. */
function lineAmount(line: string): number | undefined {
  const marked = currencyAmount(line);
  if (marked !== undefined && marked < 1_000_000) return marked;
  const vals = extractAmountsFromLine(line).filter((v) => v > 0 && v < 1_000_000);
  return vals.findLast((v) => !Number.isInteger(v)) ?? vals[vals.length - 1];
}

/**
 * The amount to pay on an invoice. `strong`: it stands on a total line ("Total", "Rechnungsbetrag", "zu zahlen",
 * "montant à payer") that is not a subtotal, a net amount or a tax line. Otherwise the first line that mentions
 * CHF or an amount word is used, as a best guess for the review.
 */
export function billTotal(text: string): { amount?: number; strong: boolean } {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const amountAt = (i: number) => lineAmount(lines[i]) ?? (lines[i + 1] && !BILL_PARTIAL.test(lines[i + 1]) ? lineAmount(lines[i + 1]) : undefined);
  let strong: number | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    if (!BILL_TOTAL.test(lines[i]) || BILL_PARTIAL.test(lines[i])) continue;
    // The last total line wins: it follows subtotals, tax and discounts.
    strong = amountAt(i) ?? strong;
  }
  if (strong !== undefined) return { amount: strong, strong: true };
  for (let i = 0; i < lines.length; i += 1) {
    if (!/(chf|betrag|montant|total)/i.test(lines[i]) || BILL_PARTIAL.test(lines[i])) continue;
    const amount = amountAt(i);
    if (amount !== undefined) return { amount, strong: false };
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (!/(chf|betrag|montant|total)/i.test(lines[i])) continue;
    const amount = amountAt(i);
    if (amount !== undefined) return { amount, strong: false };
  }
  return { strong: false };
}

/** CH / LI IBAN with a correct ISO 13616 check (mod 97). */
export function isSwissIban(value: string): boolean {
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^(?:CH|LI)\d{2}[A-Z0-9]{17}$/.test(iban)) return false;
  let remainder = 0;
  for (const c of iban.slice(4) + iban.slice(0, 4)) {
    for (const digit of /\d/.test(c) ? c : String(c.charCodeAt(0) - 55)) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function extractBill(t: string, lower: string): Extraction {
  const { amount } = billTotal(t);
  const iban = t.match(/\b(?:CH|LI)\d{2}(?:\s?[A-Z0-9]{4}){4}\s?[A-Z0-9]\b/i)?.[0]?.replace(/\s+/g, "").toUpperCase();
  const insurance = /kranken|versicherung|assurance|insurance|pr[äa]mie/.test(lower);
  return {
    kind: "bill",
    amount,
    iban,
    category: insurance ? "insurance" : "bills",
    ...generatedLabel(msg(insurance ? "summary.insuranceBill" : "summary.bill")),
  };
}

function extractNote(t: string): Extraction {
  const year = parseYearWithNoise(t);

  // Strip detected year / noisy year and short durations so they are never mistaken for CHF amounts.
  const withoutNoise = t
    .replace(/\b2[0Oo][2-6][.,'\s-]?[0-9]\b/g, " ")
    .replace(/\b\d+\s*(?:months?|monate?n?|mois|years?|jahre?n?|ans?|weeks?|wochen|days?|tage?)\b/gi, " ");

  let amount: number | undefined;
  // 1. Shorthand "≈ 25k", "~ 25k", "CHF 25k", "25.5k"
  const kMatch = withoutNoise.match(/(?:[≈~]|chf|fr\.?)?\s*(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (kMatch) {
    amount = Number(kMatch[1].replace(",", ".")) * 1000;
  }
  // 2. Explicit grouped CHF numbers: "25'000", "CHF 25 000", "25,000"
  if (amount == null) {
    const grouped = withoutNoise.match(/(?:CHF|Fr\.?|[≈~])?\s*(\d{1,3}(?:['’`\u202f\u00a0 ,]\d{3})+)(?:[.,](\d{2}))?/i);
    if (grouped) {
      const n = Number(grouped[1].replace(/['’`\u202f\u00a0 ,]/g, "") + (grouped[2] ? `.${grouped[2]}` : ""));
      if (Number.isFinite(n) && n > 0) amount = n;
    }
  }
  // 3. Explicit "CHF 25000" or fallback plain number ≥ 100
  if (amount == null) {
    const chfVal = parseChf(withoutNoise);
    if (chfVal && chfVal >= 100) amount = chfVal;
  }

  const firstLine = t
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /[A-Za-zÀ-ÿ]{2}/.test(l));

  return {
    kind: "note",
    amount,
    year,
    ...(firstLine ? { label: firstLine.slice(0, 40) } : generatedLabel(msg("summary.note"))),
  };
}

export function heuristicExtract(text: string): Extraction {
  const t = text.replace(/\r/g, "");
  const lower = t.toLowerCase();
  const kind = classifyDoc(t);

  switch (kind) {
    case "payslip":
      return extractPayslip(t);
    case "listing":
      return extractListing(t, lower);
    case "receipt":
      return { kind, ...parseReceipt(t), date: parseDate(t), ...generatedLabel(msg("kind.receipt")) };
    case "bill":
      return extractBill(t, lower);
    default:
      return extractNote(t);
  }
}
