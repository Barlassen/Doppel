import type { AccountRecord } from "@/lib/accounts/types";
import type { InvestmentTrade, Transaction, TransactionCategory } from "@/lib/finance/types";
import { classifyRow } from "./categorize";
import { cents, merchantKey, round2 } from "./text";
import type { ParsedStatement, ReviewCounts, ReviewRow, ReviewTrade } from "./types";

/**
 * Import review: categorised rows, duplicates against what the account already has, and the counts shown above
 * the table. Pure; the UI keeps the result in state and edits categories in place.
 *
 * Dedupe rules
 *  - a row with a bank reference (camt `AcctSvcrRef`, ZKB-Referenz, UBS transaction no.) is a duplicate when an
 *    earlier import of this account recorded the same reference, or the same reference appears earlier in the file;
 *  - otherwise (and for rows whose reference is new) it is a duplicate when the account already has a transaction
 *    with the same date, amount (to the cent) and normalised merchant. Matching is one-to-one, so two identical
 *    coffees on the same day in one file both stay when the account had neither;
 *  - trades match on date, account, instrument, side and amount, also one-to-one.
 */

export interface ExistingData {
  transactions: AccountRecord<Transaction>[];
  trades: AccountRecord<InvestmentTrade>[];
  /** Bank references recorded by earlier imports whose transactions still exist. */
  refs: ReadonlySet<string>;
}

export interface Review {
  rows: ReviewRow[];
  trades: ReviewTrade[];
  skipped: ParsedStatement["skipped"];
  notes: ParsedStatement["notes"];
}

export const txKey = (t: Pick<Transaction, "date" | "amount" | "merchant">) => `${t.date}|${cents(t.amount)}|${merchantKey(t.merchant)}`;
export const tradeKey = (t: InvestmentTrade) => `${t.date}|${t.account}|${merchantKey(t.instrument)}|${t.side}|${cents(t.amount)}`;

function multiset(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}
const take = (m: Map<string, number>, k: string) => {
  const n = m.get(k) ?? 0;
  if (n > 0) m.set(k, n - 1);
  return n > 0;
};

export function buildReview(parsed: ParsedStatement, existing: ExistingData, overrides: Readonly<Record<string, TransactionCategory>> = {}): Review {
  const have = multiset(existing.transactions.map((r) => txKey(r.value)));
  const seenRefs = new Set(existing.refs);
  const rows: ReviewRow[] = parsed.rows.map((row, i) => {
    const c = classifyRow(row, overrides);
    const amount = round2(-row.signed);
    const counted = c.kind === "spend" || c.kind === "refund";
    let duplicate = false;
    if (counted) {
      if (row.ref && seenRefs.has(row.ref)) duplicate = true;
      else duplicate = take(have, txKey({ date: row.date, amount, merchant: c.merchant }));
      if (row.ref) seenRefs.add(row.ref);
    }
    return {
      id: `r${i}`,
      line: row.line,
      date: row.date,
      merchant: c.merchant,
      raw: row.description,
      amount,
      kind: c.kind,
      category: c.category ?? "other",
      source: c.source ?? "fallback",
      needsReview: counted && !c.category,
      duplicate,
      ...(row.ref ? { ref: row.ref } : {}),
    };
  });
  const haveTrades = multiset(existing.trades.map((r) => tradeKey(r.value)));
  const trades = parsed.trades.map((trade, i) => ({ id: `t${i}`, trade, duplicate: take(haveTrades, tradeKey(trade)) }));
  return { rows, trades, skipped: parsed.skipped, notes: parsed.notes };
}

export const isAdded = (r: ReviewRow) => (r.kind === "spend" || r.kind === "refund") && !r.duplicate;

export function reviewCounts(review: Review): ReviewCounts {
  const added = review.rows.filter(isAdded);
  return {
    transactions: added.length,
    trades: review.trades.filter((t) => !t.duplicate).length,
    duplicates: review.rows.filter((r) => r.duplicate).length + review.trades.filter((t) => t.duplicate).length,
    income: review.rows.filter((r) => r.kind === "income").length,
    transfers: review.rows.filter((r) => r.kind === "transfer").length,
    review: added.filter((r) => r.needsReview).length,
    skipped: review.skipped.length,
  };
}

/** Sets a row's category by hand; every other new row of the same merchant follows (it is a merchant correction). */
export function setRowCategory(review: Review, rowId: string, category: TransactionCategory): Review {
  const target = review.rows.find((r) => r.id === rowId);
  if (!target) return review;
  const key = merchantKey(target.merchant);
  return {
    ...review,
    rows: review.rows.map((r) =>
      r.id === rowId || ((r.kind === "spend" || r.kind === "refund") && merchantKey(r.merchant) === key)
        ? { ...r, category, source: "override", needsReview: false }
        : r,
    ),
  };
}

/** Applies model / cache answers to rows still unresolved. `answers` is keyed by `merchantKey(merchant)`. */
export function applyCategories(review: Review, answers: ReadonlyMap<string, TransactionCategory>, source: "model" | "cache"): Review {
  return {
    ...review,
    rows: review.rows.map((r) => {
      if (r.source !== "fallback") return r;
      const c = answers.get(merchantKey(r.merchant));
      if (!c) return r;
      return { ...r, category: c, source, needsReview: c === "other" };
    }),
  };
}

/** Unique merchant names (first spelling) of the new rows no local rule could place. */
export function unresolvedMerchants(review: Review): string[] {
  const seen = new Map<string, string>();
  for (const r of review.rows) if (isAdded(r) && r.source === "fallback" && !seen.has(merchantKey(r.merchant))) seen.set(merchantKey(r.merchant), r.merchant);
  return [...seen.values()];
}

/** What gets written to the account: transactions (with their bank reference for later dedupe) and trades. */
export function finalizeReview(review: Review): { transactions: Transaction[]; refs: (string | undefined)[]; trades: InvestmentTrade[] } {
  const added = review.rows.filter(isAdded);
  return {
    transactions: added.map((r) => ({ date: r.date, merchant: r.merchant, category: r.category, amount: r.amount })),
    refs: added.map((r) => r.ref),
    trades: review.trades.filter((t) => !t.duplicate).map((t) => t.trade),
  };
}

/** Merchant → category corrections made in this review (to store as account overrides). */
export function reviewOverrides(review: Review): Record<string, TransactionCategory> {
  const out: Record<string, TransactionCategory> = {};
  for (const r of review.rows) if (r.source === "override" && isAdded(r)) out[merchantKey(r.merchant)] = r.category;
  return out;
}
