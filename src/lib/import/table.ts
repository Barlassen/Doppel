import { detectDelimiter, headerKey, parseAmount, parseCsv, parseDate, type Delimiter } from "./text";

/** A CSV file split into its header row and data rows (preamble lines skipped). */
export interface CsvTable {
  delimiter: Delimiter;
  /** Original header cells. */
  headers: string[];
  /** `headerKey()` of each header cell. */
  keys: string[];
  rows: string[][];
  /** 1-based file line of the first data row (approximate when quoted fields contain newlines). */
  firstLine: number;
}

/** Header words of every supported layout plus generic ones; used to find the header row below a preamble. */
export const HEADER_VOCABULARY = new Set([
  // generic DE / FR / IT / EN
  "date", "datum", "data", "buchungsdatum", "valuta", "valutadatum", "value date", "booking date", "date de comptabilisation",
  "text", "buchungstext", "beschreibung", "description", "libellé", "libelle", "details", "merchant", "empfänger", "zahlungszweck",
  "amount", "betrag", "montant", "importo", "debit", "credit", "belastung", "gutschrift", "lastschrift", "débit", "crédit",
  "currency", "währung", "whg", "devise", "saldo", "balance", "solde", "type", "typ",
  // bank profiles
  "abschlussdatum", "abschlusszeit", "einzelbetrag", "beschreibung1", "beschreibung2", "beschreibung3", "transaktions-nr.",
  "trade date", "description1", "description2", "description3", "individual amount", "transaction no.",
  "avisierungstext", "gutschrift in chf", "lastschrift in chf", "texte de notification", "crédit en chf", "débit en chf",
  "bewegungstyp", "zkb-referenz", "referenznummer", "belastung chf", "gutschrift chf", "saldo chf", "betrag detail",
  "iban", "booked at", "credit/debit amount", "valuta date", "original amount", "original currency", "exchange rate", "subject",
  "category", "tags", "started date", "completed date", "product", "fee", "state", "activity type", "activity name",
  "debit currency", "credit currency", "card number", "locality", "recipient", "sender", "fees/commission",
  // broker profiles
  "order #", "transaction", "symbol", "name", "isin", "quantity", "unit price", "costs", "net amount", "accrued interest",
  "tradedate", "buy/sell", "tradeprice", "proceeds", "currencyprimary", "assetclass", "ibcommission", "date/time", "t. price",
  "portfolio", "instrument", "units", "price (chf)", "amount (chf)", "transaktionsart", "fonds", "anteile", "kurs", "betrag chf",
]);

const vocabularyHits = (row: string[]) => row.filter((c) => HEADER_VOCABULARY.has(headerKey(c))).length;
const looksLikeData = (row: string[]) => row.some((c) => parseDate(c)) && row.some((c) => !parseDate(c) && parseAmount(c) !== undefined);

/**
 * Splits a CSV file: detects the delimiter, skips preamble lines (account number, period…) and finds the header row:
 * the first row with ≥ 2 known header words that is followed by a data row. Falls back to the first row that is as
 * wide as the data.
 */
export function readTable(text: string, delimiter: Delimiter = detectDelimiter(text)): CsvTable {
  const all = parseCsv(text, delimiter);
  const lineOf = (i: number) => i + 1;
  let header = -1;
  for (let i = 0; i < Math.min(all.length, 40); i++) {
    if (vocabularyHits(all[i]) >= 2 && !looksLikeData(all[i]) && (i + 1 >= all.length || looksLikeData(all[i + 1]) || vocabularyHits(all[i]) >= 3)) {
      header = i;
      break;
    }
  }
  if (header < 0) {
    const widths = new Map<number, number>();
    for (const r of all) widths.set(r.length, (widths.get(r.length) ?? 0) + 1);
    const width = [...widths].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
    header = Math.max(0, all.findIndex((r) => r.length === width));
  }
  const headers = all[header] ?? [];
  return {
    delimiter,
    headers,
    keys: headers.map(headerKey),
    rows: all.slice(header + 1).filter((r) => vocabularyHits(r) < Math.max(2, headers.length - 1) || looksLikeData(r)),
    firstLine: lineOf(header + 1),
  };
}

/** Index of the first header matching any alternative (exact key), or -1. */
export function column(table: Pick<CsvTable, "keys">, alternatives: readonly string[] | undefined): number {
  if (!alternatives) return -1;
  for (const alt of alternatives) {
    const i = table.keys.indexOf(alt);
    if (i >= 0) return i;
  }
  return -1;
}

/** True when every key of at least one marker set is a header. */
export function hasMarker(table: Pick<CsvTable, "keys">, markers: readonly (readonly string[])[]): boolean {
  return markers.some((set) => set.every((k) => table.keys.includes(k)));
}
