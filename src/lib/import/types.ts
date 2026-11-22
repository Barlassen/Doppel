import type { InvestmentTrade, TransactionCategory } from "@/lib/finance/types";
import type { Msg } from "@/lib/i18n/types";

export type StatementFormat = "bank-csv" | "camt.053" | "camt.054" | "broker-csv" | "mt940";

/** One booking as read from a bank file, before categorisation. `signed` follows the bank: negative = money out. */
export interface StatementRow {
  /** 1-based line (CSV) or entry number (camt), for messages. */
  line: number;
  date: string;
  /** Booking text / remittance info as printed. */
  description: string;
  /** Counterparty name when the file has a separate column (camt `RltdPties`, Revolut description…). */
  counterparty?: string;
  signed: number;
  currency: string;
  /** Bank reference (`AcctSvcrRef`, ZKB-Referenz, transaction number). Used for dedupe. */
  ref?: string;
  /** Transaction type column, e.g. Revolut `TOPUP`, Yuh `ACTIVITY TYPE`. */
  type?: string;
  /** camt `RvslInd`: the booking takes back an earlier one (a credit is money returned, not income). */
  reversal?: boolean;
}

export type SkipReason = "badDate" | "badAmount" | "foreignCurrency" | "zero" | "notATrade" | "pending";

export interface SkippedRow {
  line: number;
  reason: SkipReason;
  /** Currency of a skipped foreign-currency row. */
  currency?: string;
}

/** What a parser returns. Bank files fill `rows`, broker files fill `trades`. */
export interface ParsedStatement {
  format: StatementFormat;
  /** Profile id (`zkb`, `postfinance`, `swissquote`, …) or "manual". */
  profile: string;
  rows: StatementRow[];
  trades: InvestmentTrade[];
  skipped: SkippedRow[];
  /** Notes for the review (e.g. deposits ignored because the file has fund purchases). */
  notes: Msg[];
}

/** How a row ends up: spending, a refund (negative spending), salary/other income, or a transfer between own accounts. */
export type RowKind = "spend" | "refund" | "income" | "transfer";

/** Where a category came from. "fallback" = nothing matched and no model answer: review needed. */
export type CategorySource = "override" | "dictionary" | "keyword" | "cache" | "model" | "fallback";

export interface ReviewRow {
  id: string;
  line: number;
  date: string;
  merchant: string;
  /** The original booking text (shown on hover / in the details). */
  raw: string;
  /** CHF, positive = spend (Transaction convention). Income and transfers are kept for the counts only. */
  amount: number;
  kind: RowKind;
  category: TransactionCategory;
  source: CategorySource;
  needsReview: boolean;
  duplicate: boolean;
  ref?: string;
}

export interface ReviewTrade {
  id: string;
  trade: InvestmentTrade;
  duplicate: boolean;
}

export interface ReviewCounts {
  /** Transactions that will be added. */
  transactions: number;
  trades: number;
  duplicates: number;
  income: number;
  transfers: number;
  review: number;
  skipped: number;
}

export type ManualTarget = "date" | "description" | "amount" | "debit" | "credit" | "currency";
export type ManualTradeTarget = "date" | "side" | "instrument" | "units" | "price" | "amount" | "currency";

export interface ImportCategoryInfo {
  category: TransactionCategory;
  source: CategorySource;
}

export type { TransactionCategory };
