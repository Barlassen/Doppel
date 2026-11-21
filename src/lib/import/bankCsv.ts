import { msg } from "@/lib/i18n/types";
import { column, hasMarker, readTable, type CsvTable } from "./table";
import { headerKey, parseAmount, parseDate, round2 } from "./text";
import type { ParsedStatement, SkippedRow, StatementRow } from "./types";

/**
 * Header profiles for common Swiss bank exports. Each one is BASED ON THE TYPICAL EXPORT LAYOUT of that bank as
 * publicly described; none is verified against real customer files. When no profile matches, the user maps the
 * columns by hand (`parseBankManual`).
 *
 * Column alternatives are `headerKey()`s (lower case). `marker`: the file is this bank when every key of one set is
 * a header.
 */
export interface BankProfile {
  id: string;
  name: string;
  marker: readonly (readonly string[])[];
  date: readonly string[];
  /** Columns joined (in this order, empty and repeated cells dropped) into the booking text. */
  description: readonly (readonly string[])[];
  /** Column holding the counterparty / merchant on its own, if any. */
  counterparty?: readonly string[];
  /** Signed amount (negative = money out). */
  amount?: readonly string[];
  debit?: readonly string[];
  credit?: readonly string[];
  currency?: readonly string[];
  ref?: readonly string[];
  fee?: readonly string[];
  type?: readonly string[];
  /** Rows whose state column is not one of `states` are skipped (Revolut: pending / reverted). */
  state?: { column: readonly string[]; ok: readonly string[] };
}

export const BANK_PROFILES: readonly BankProfile[] = [
  {
    id: "ubs",
    name: "UBS",
    marker: [["beschreibung1"], ["description1"]],
    date: ["buchungsdatum", "booking date", "abschlussdatum", "trade date"],
    description: [["beschreibung1", "description1"], ["beschreibung2", "description2"], ["beschreibung3", "description3"]],
    counterparty: ["beschreibung1", "description1"],
    debit: ["belastung", "debit"],
    credit: ["gutschrift", "credit"],
    amount: ["einzelbetrag", "individual amount"],
    currency: ["währung", "currency"],
    ref: ["transaktions-nr.", "transaction no."],
  },
  {
    id: "postfinance",
    name: "PostFinance",
    marker: [["avisierungstext"], ["texte de notification"], ["testo di avviso"], ["notification text"]],
    date: ["buchungsdatum", "datum", "date de comptabilisation", "date", "data"],
    description: [["avisierungstext", "texte de notification", "testo di avviso", "notification text"]],
    credit: ["gutschrift in chf", "crédit en chf", "accredito in chf", "credit in chf", "gutschrift"],
    debit: ["lastschrift in chf", "débit en chf", "addebito in chf", "debit in chf", "lastschrift"],
  },
  {
    id: "zkb",
    name: "ZKB",
    marker: [["zkb-referenz"]],
    date: ["datum", "buchungsdatum"],
    description: [["buchungstext"], ["zahlungszweck"]],
    debit: ["belastung chf"],
    credit: ["gutschrift chf"],
    currency: ["whg"],
    ref: ["zkb-referenz"],
  },
  {
    id: "raiffeisen",
    name: "Raiffeisen",
    marker: [["credit/debit amount"], ["booked at", "text"], ["iban", "buchungstext", "betrag", "valuta"]],
    date: ["booked at", "buchungsdatum"],
    description: [["text", "buchungstext"]],
    amount: ["credit/debit amount", "betrag"],
  },
  {
    id: "neon",
    name: "neon",
    marker: [["original amount", "original currency", "exchange rate"]],
    date: ["date"],
    description: [["description"], ["subject"]],
    counterparty: ["description"],
    amount: ["amount"],
  },
  {
    id: "revolut",
    name: "Revolut",
    marker: [["started date", "completed date", "product"]],
    date: ["completed date", "started date"],
    description: [["description"]],
    counterparty: ["description"],
    amount: ["amount"],
    fee: ["fee"],
    currency: ["currency"],
    type: ["type"],
    state: { column: ["state"], ok: ["completed", "abgeschlossen", "terminé", ""] },
  },
  {
    id: "yuh",
    name: "Yuh",
    marker: [["activity type", "activity name"]],
    date: ["date"],
    description: [["activity name"], ["recipient"], ["sender"]],
    counterparty: ["activity name"],
    debit: ["debit"],
    credit: ["credit"],
    currency: ["debit currency", "credit currency"],
    fee: ["fees/commission"],
    type: ["activity type"],
  },
];

export function detectBankProfile(table: CsvTable): BankProfile | undefined {
  return BANK_PROFILES.find(
    (p) => hasMarker(table, p.marker) && column(table, p.date) >= 0 && (column(table, p.amount) >= 0 || column(table, p.debit) >= 0 || column(table, p.credit) >= 0),
  );
}

/** A hand-made column mapping (manual mapping UI). Indexes into the header row. */
export interface BankMapping {
  date: number;
  description: number[];
  /** Signed amount column; or use debit / credit. */
  amount?: number;
  debit?: number;
  credit?: number;
  currency?: number;
  /** The signed amount column uses positive = money out. */
  invert?: boolean;
}

interface Resolved {
  date: number;
  description: number[];
  counterparty: number;
  amount: number;
  debit: number;
  credit: number;
  currency: number[];
  ref: number;
  fee: number;
  type: number;
  state?: { column: number; ok: readonly string[] };
  invert: boolean;
}

function resolveProfile(table: CsvTable, p: BankProfile): Resolved {
  return {
    date: column(table, p.date),
    description: p.description.map((alts) => column(table, alts)).filter((i) => i >= 0),
    counterparty: column(table, p.counterparty),
    amount: column(table, p.amount),
    debit: column(table, p.debit),
    credit: column(table, p.credit),
    currency: (p.currency ?? []).map((c) => column(table, [c])).filter((i) => i >= 0),
    ref: column(table, p.ref),
    fee: column(table, p.fee),
    type: column(table, p.type),
    state: p.state ? { column: column(table, p.state.column), ok: p.state.ok } : undefined,
    invert: false,
  };
}

function rowsFrom(table: CsvTable, r: Resolved): { rows: StatementRow[]; skipped: SkippedRow[] } {
  const rows: StatementRow[] = [];
  const skipped: SkippedRow[] = [];
  table.rows.forEach((cells, i) => {
    const line = table.firstLine + i + 1;
    const cell = (idx: number) => (idx >= 0 ? (cells[idx] ?? "").trim() : "");
    if (r.state && r.state.column >= 0 && !r.state.ok.includes(cell(r.state.column).toLowerCase())) {
      skipped.push({ line, reason: "pending" });
      return;
    }
    const date = parseDate(cell(r.date));
    if (!date) {
      skipped.push({ line, reason: "badDate" });
      return;
    }
    let signed: number | undefined;
    const debit = parseAmount(cell(r.debit));
    const credit = parseAmount(cell(r.credit));
    if (debit !== undefined || credit !== undefined) signed = (credit !== undefined ? Math.abs(credit) : 0) - (debit !== undefined ? Math.abs(debit) : 0);
    else if (r.amount >= 0) {
      const a = parseAmount(cell(r.amount));
      if (a !== undefined) signed = r.invert ? -a : a;
    }
    if (signed === undefined) {
      skipped.push({ line, reason: "badAmount" });
      return;
    }
    const fee = parseAmount(cell(r.fee));
    if (fee) signed -= Math.abs(fee);
    signed = round2(signed);
    if (signed === 0) {
      skipped.push({ line, reason: "zero" });
      return;
    }
    const currency = (r.currency.map(cell).find(Boolean) || "CHF").toUpperCase();
    if (currency !== "CHF") {
      skipped.push({ line, reason: "foreignCurrency", currency });
      return;
    }
    const parts: string[] = [];
    for (const idx of r.description) {
      const v = cell(idx);
      if (v && !parts.includes(v)) parts.push(v);
    }
    rows.push({
      line,
      date,
      description: parts.join(" · "),
      counterparty: cell(r.counterparty) || undefined,
      signed,
      currency,
      ref: cell(r.ref) || undefined,
      type: cell(r.type) || undefined,
    });
  });
  return { rows, skipped };
}

/** Parses a bank CSV with a detected profile. Returns undefined when no profile matches (→ manual mapping). */
export function parseBankCsv(text: string): (ParsedStatement & { table: CsvTable }) | undefined {
  const table = readTable(text);
  const profile = detectBankProfile(table);
  if (!profile) return undefined;
  const { rows, skipped } = rowsFrom(table, resolveProfile(table, profile));
  return { format: "bank-csv", profile: profile.id, rows, trades: [], skipped, notes: [], table };
}

export function parseBankManual(table: CsvTable, m: BankMapping): ParsedStatement {
  const { rows, skipped } = rowsFrom(table, {
    date: m.date,
    description: m.description,
    counterparty: -1,
    amount: m.amount ?? -1,
    debit: m.debit ?? -1,
    credit: m.credit ?? -1,
    currency: m.currency !== undefined && m.currency >= 0 ? [m.currency] : [],
    ref: -1,
    fee: -1,
    type: -1,
    invert: !!m.invert,
  });
  return { format: "bank-csv", profile: "manual", rows, trades: [], skipped, notes: rows.length ? [] : [msg("data.noRows")] };
}

const GUESS = {
  date: ["buchungsdatum", "booking date", "datum", "date", "data", "transaction date", "date de comptabilisation"],
  description: ["buchungstext", "beschreibung", "description", "text", "libellé", "libelle", "details", "merchant", "empfänger", "avisierungstext", "zahlungszweck", "verwendungszweck", "payee"],
  amount: ["amount", "betrag", "montant", "importo", "amount (chf)", "betrag chf", "betrag (chf)"],
  debit: ["debit", "belastung", "lastschrift", "débit", "soll", "addebito", "belastung chf", "lastschrift in chf"],
  credit: ["credit", "gutschrift", "crédit", "haben", "accredito", "gutschrift chf", "gutschrift in chf"],
  currency: ["currency", "währung", "whg", "devise", "monnaie", "ccy", "valuta (währung)"],
};

/** Best-effort default for the manual mapping UI. */
export function guessBankMapping(table: CsvTable): BankMapping {
  const find = (alts: string[]) => {
    const exact = column(table, alts);
    if (exact >= 0) return exact;
    return table.keys.findIndex((k) => alts.some((a) => k.startsWith(a)));
  };
  const debit = find(GUESS.debit);
  const credit = find(GUESS.credit);
  const amount = find(GUESS.amount);
  const description = find(GUESS.description);
  const currency = find(GUESS.currency);
  return {
    date: Math.max(0, find(GUESS.date)),
    description: description >= 0 ? [description] : [],
    ...(debit >= 0 || credit >= 0 ? { debit: debit >= 0 ? debit : undefined, credit: credit >= 0 ? credit : undefined } : { amount: amount >= 0 ? amount : undefined }),
    currency: currency >= 0 ? currency : undefined,
  };
}

export { headerKey };
