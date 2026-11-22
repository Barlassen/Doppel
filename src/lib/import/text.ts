/**
 * Low-level helpers shared by the statement importers: byte decoding, a quote-aware CSV reader, delimiter and
 * header detection, Swiss dates and amounts, and merchant normalisation. Pure and deterministic (browser + Node).
 */

/** UTF-16 without a BOM: in Latin text every second byte is NUL. Looks at the first 400 bytes. */
function utf16Guess(bytes: Uint8Array): "utf-16le" | "utf-16be" | undefined {
  const n = Math.min(bytes.length, 400) & ~1;
  if (n < 8) return;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) even++;
    if (bytes[i + 1] === 0) odd++;
  }
  if (odd > n * 0.3 && even < n * 0.05) return "utf-16le";
  if (even > n * 0.3 && odd < n * 0.05) return "utf-16be";
}

/**
 * Decodes a file: UTF-16 (BOM, or the NUL pattern of an Excel "Unicode text" export), UTF-8 with or without BOM,
 * else Windows-1252 (older Swiss e-banking exports).
 */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252" } {
  const bom16 = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : undefined;
  const wide = bom16 ?? utf16Guess(bytes);
  if (wide) return { text: new TextDecoder(wide).decode(bom16 ? bytes.subarray(2) : bytes), encoding: wide };
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(body), encoding: "windows-1252" };
  }
}

/** Quote-aware CSV parser (RFC 4180 style: "" escapes a quote, quoted fields may contain the delimiter and newlines). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.replace(/^\ufeff/, "");
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (c === "\r" && src[i + 1] === "\n") i++;
    } else field += c;
    i++;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ""));
}

export const DELIMITERS = [";", ",", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/**
 * Picks the delimiter whose most common field count (≥ 2) covers the most lines among the first 40.
 * Preamble lines ("Konto:;CH93…") have fewer fields than the data, so the data rows win.
 */
export function detectDelimiter(text: string): Delimiter {
  let best: { d: Delimiter; score: number; width: number } = { d: ";", score: -1, width: 0 };
  for (const d of DELIMITERS) {
    const rows = parseCsv(text.split(/\r?\n/).slice(0, 60).join("\n"), d).slice(0, 40);
    const freq = new Map<number, number>();
    for (const r of rows) if (r.length >= 2) freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
    let width = 0;
    let score = 0;
    for (const [w, n] of freq) if (n > score || (n === score && w > width)) [width, score] = [w, n];
    if (score > best.score || (score === best.score && width > best.width)) best = { d, score, width };
  }
  return best.d;
}

/** Header cell → comparable key: lower case, no quotes, single spaces. */
export const headerKey = (s: string) =>
  s.replace(/^\ufeff/, "").replace(/["']/g, "").trim().toLowerCase().replace(/\s+/g, " ");

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number): string | undefined {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** `dd.mm.yyyy`, `dd.mm.yy`, `yyyy-mm-dd` (optionally with a time or `T…`), `dd/mm/yyyy`, `dd-mm-yyyy` → ISO date. */
export function parseDate(raw: string | undefined): string | undefined {
  const s = (raw ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s,;].*)?$/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?:[\s,].*)?$/.exec(s);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,].*)?$/.exec(s);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[\s,].*)?$/.exec(s);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  m = /^(\d{4})(\d{2})(\d{2})(?:[;\s].*)?$/.exec(s); // IBKR Flex: 20260626 or 20260626;101500
  if (m) return validDate(+m[1], +m[2], +m[3]);
}

/**
 * Swiss and European number formats: `1'234.50`, `1’234.50`, `-12.30`, `12,30`, `1.234,50`, `(12.30)`, `12.30-`,
 * `(-12.30)`, `CHF 12.–`. Returns undefined for anything else (never guesses).
 */
export function parseAmount(raw: string | undefined): number | undefined {
  let s = (raw ?? "").trim().replace(/[\u00a0\u202f\u2009 ]/g, "");
  if (!s) return;
  s = s.replace(/^(?:CHF|EUR|USD|GBP|Fr\.?|SFr\.?)/i, "").replace(/(?:CHF|EUR|USD|GBP)$/i, "");
  let negative = false;
  // Accounting brackets mean "negative". A minus inside them says the same thing again; it does not cancel it.
  const bracketed = /^\(.*\)$/.test(s);
  if (bracketed) s = s.slice(1, -1);
  if (/^[-−–]/.test(s)) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[.,][-–]$/, "");
  if (/[-−]$/.test(s)) {
    // "-12.30-" is not a number any bank prints.
    if (negative) return;
    negative = true;
    s = s.slice(0, -1);
  }
  negative = negative || bracketed;
  s = s.replace(/['’`´]/g, "");
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) {
    if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
    else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
    else return;
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return;
  const n = Number(s);
  if (!Number.isFinite(n)) return;
  return negative ? -n : n;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const cents = (n: number) => Math.round(n * 100);

/** Booking-text prefixes that are not part of the merchant (DE / FR / IT / EN e-banking wording). */
const PREFIX =
  /^(?:(?:(?:zkb|ubs|bcv|bcge|lukb|bekb|blkb|raiffeisen|postfinance)\s+(?:visa\s+debit|debit\s*card|debitkarte|maestro|card)|zahlung|einkauf|kauf|bezug|belastung|lastschrift|dauerauftrag|e-?banking(?:-auftrag| auftrag)?|debitkarte|debit card|debit mastercard|visa debit|maestro|card payment|kartenzahlung|karte|paiement(?: par)?(?: carte)?|achat|ordre permanent|ordre e-banking|pagamento(?: con carta)?|acquisto|ordine permanente|lsv\+?|direct debit|ebill|e-?rechnung|online payment|purchase|payment|twint|apple pay|google pay)\b[\s:,\-–/*]*)+/i;

/**
 * Booking text → merchant name: drops e-banking prefixes, card numbers, trailing dates/times and reference noise.
 * "Debitkarte Migros Zürich 12.06.2026 Kartennr. xxxx1234" → "Migros Zürich".
 */
export function normalizeMerchant(text: string): string {
  const steps: RegExp[] = [
    PREFIX,
    /\b(?:karten?(?:nr|nummer)\.?|card(?: no\.?| number)?|carte n[°o]?\.?|num[ée]ro de carte:?)\s*[x*\d\s]+$/i,
    /\s+[x*]{2,}\d{2,4}$/i,
    /\s+\d{1,2}[./]\d{1,2}[./]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/,
    /\s+\d{1,2}:\d{2}(?::\d{2})?$/,
    /[\s,;:\-–]+$/,
  ];
  let s = text.replace(/\s+/g, " ").trim();
  for (const re of steps) s = s.replace(re, "").trim();
  return s || text.trim();
}

/** Comparable merchant key (dedupe, overrides, model cache): lower case, no accents, letters and digits only. */
export function merchantKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+&]+/g, " ")
    .trim();
}
