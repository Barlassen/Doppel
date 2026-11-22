import { msg, type Msg } from "@/lib/i18n/types";
import { parseBankCsv } from "./bankCsv";
import { parseBrokerCsv } from "./brokerCsv";
import { isCamt, parseCamt } from "./camt";
import { isMt940, parseMt940 } from "./mt940";
import { readTable, type CsvTable } from "./table";
import { decodeBytes } from "./text";
import type { ParsedStatement } from "./types";

export * from "./types";
export { BANK_PROFILES, guessBankMapping, parseBankManual, type BankMapping } from "./bankCsv";
export { BROKER_PROFILES, guessTradeMapping, parseTradesManual, type TradeMapping } from "./brokerCsv";
export type { CsvTable } from "./table";
export { isMt940, parseMt940 } from "./mt940";
export { summarizeParsed, summarizeStatement, summaryAskFacts } from "./summarize";
export type { Cadence, CategorySpend, FactId, FixedKind, IncomeSource, InferredFact, RecurringCost, StatementSummary } from "./summarize";

/** Statement files above this size are refused (a year of a busy account is well below 1 MB). */
export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

export type ReadResult =
  | { kind: "parsed"; parsed: ParsedStatement; encoding: string }
  | { kind: "mapping"; table: CsvTable; encoding: string }
  | { kind: "error"; error: Msg };

/**
 * Any supported statement file → parsed rows / trades, or a table for the manual column mapping.
 * Order: camt XML, MT940, broker / 3a layouts, bank layouts, then manual mapping. 0 tokens, nothing leaves the browser.
 */
export function readStatement(fileName: string, bytes: Uint8Array): ReadResult {
  if (bytes.length > MAX_STATEMENT_BYTES) return { kind: "error", error: msg("data.tooBig") };
  const { text, encoding } = decodeBytes(bytes);
  const head = text.trimStart().slice(0, 400);
  if (head.startsWith("<") || /\.xml$/i.test(fileName)) {
    if (!isCamt(text)) return { kind: "error", error: msg("data.unsupportedXml") };
    const parsed = parseCamt(text);
    return parsed ? { kind: "parsed", parsed, encoding } : { kind: "error", error: msg("data.badXml") };
  }
  if (isMt940(text)) {
    const parsed = parseMt940(text);
    if (parsed) return { kind: "parsed", parsed, encoding };
  }
  const broker = parseBrokerCsv(text);
  if (broker && (broker.trades.length || broker.skipped.length)) return { kind: "parsed", parsed: broker, encoding };
  const bank = parseBankCsv(text);
  if (bank) return { kind: "parsed", parsed: bank, encoding };
  const table = readTable(text);
  if (table.headers.length >= 2 && table.rows.length) return { kind: "mapping", table, encoding };
  return { kind: "error", error: msg("data.unreadable") };
}
