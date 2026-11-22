"use client";

import { useState } from "react";
import type { Account } from "@/lib/accounts/types";
import { categoryMsg, merchantText } from "@/lib/data/merchants";
import { dateCh, receiptMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/types";
import { summarizeStatement, type FactId, type InferredFact, type ReviewRow, type ReviewTrade, type StatementSummary } from "@/lib/import";
import type { FactAnswer, IncomeRow, StatementMemory } from "./statementMemory";
import { Disclosure } from "./ui";

/** A booking a fact or a recurring payee rests on, for the evidence list. */
export interface EvidenceRow {
  date: string;
  merchant: string;
  /** CHF, statement style: negative = money out. */
  signed: number;
}

export interface Learned {
  /** Undefined when the account has neither transactions nor trades. */
  summary?: StatementSummary;
  evidence: ReadonlyMap<string, EvidenceRow>;
  /** Take-home pay of the profile, shown when the data holds no income bookings. */
  profileIncome: number | null;
}

/**
 * THE adapter of the panel: the account's bookings → the statement summary of `src/lib/import/summarize.ts`.
 * The accounts store keeps spending and trades; the income bookings of each import come from `statementMemory`
 * (only those whose import still exists). Pure: 0 tokens, nothing leaves the browser.
 */
export function learnedFrom(account: Account, income: readonly IncomeRow[], importIds: readonly string[]): Learned {
  const live = new Set(importIds);
  const rows: ReviewRow[] = [
    ...account.profile.transactions.map((t, i): ReviewRow => ({
      id: `tx${i}`, line: i + 1, date: t.date, merchant: t.merchant, raw: t.merchant, amount: t.amount,
      kind: t.amount < 0 ? "refund" : "spend", category: t.category, source: "dictionary", needsReview: false, duplicate: false,
    })),
    ...income.filter((r) => live.has(r.importId)).map((r, i): ReviewRow => ({
      id: `in${i}`, line: i + 1, date: r.date, merchant: r.merchant, raw: r.merchant, amount: -r.amount,
      kind: "income", category: "other", source: "dictionary", needsReview: false, duplicate: false,
    })),
  ];
  const trades: ReviewTrade[] = account.profile.trades.map((trade, i) => ({ id: `tr${i}`, trade, duplicate: false }));
  const summary = summarizeStatement({ rows, trades });
  const evidence = new Map<string, EvidenceRow>();
  for (const r of rows) evidence.set(r.id, { date: r.date, merchant: r.merchant, signed: -r.amount });
  for (const t of trades) evidence.set(t.id, { date: t.trade.date, merchant: t.trade.instrument, signed: t.trade.side === "sell" ? t.trade.amount : -t.trade.amount });
  return { summary, evidence, profileIncome: summary && summary.income.monthlyAvg > 0 ? null : account.profile.netIncomeMonth };
}

/** Below this confidence a fact is put as a question (see `InferredFact.confidence`). */
const SURE = 0.5;
/** Evidence rows listed per fact before "and n more". */
const EVIDENCE_SHOWN = 6;
const pill = "rounded-full border border-line px-2.5 py-1 text-[11px] font-medium enabled:hover:border-ink-3 disabled:opacity-45";

/**
 * "What the twin learned": the statement summary's headline lines, the inferred life facts with a confirm / reject
 * control each, and the recurring payees and categories behind one disclosure.
 */
export function LearnedPanel({
  learned,
  memory,
  fresh,
  onAnswer,
  onForget,
}: {
  learned: Learned;
  memory: StatementMemory;
  /** A statement was just imported: the panel is tinted. */
  fresh?: boolean;
  /** Confirm or reject a fact (the parent applies what a confirmation means for the twin). */
  onAnswer: (fact: InferredFact, answer: FactAnswer) => void;
  /** Forget the answers and ask again. */
  onForget: () => void;
}) {
  const { t, tm, fmt } = useI18n();
  const [noted, setNoted] = useState<FactId | null>(null);
  const { summary, evidence, profileIncome } = learned;
  const facts = summary?.facts.filter((f) => memory.facts[f.id] !== "rejected") ?? [];
  const rejected = summary ? summary.facts.length - facts.length : 0;
  return (
    <div className={`rounded-xl px-3 py-2.5 ${fresh ? "bg-good/10" : "bg-surface-2"}`} data-testid="learned">
      <h4 className="text-sm font-semibold">{t("ux.learned.title")}</h4>
      {!summary ? (
        <p className="mt-1 text-xs text-ink-2">{t("ux.learned.empty")}</p>
      ) : (
        <>
          {facts.length > 0 && (
            <ul className="mt-2.5 space-y-2 border-t border-line pt-2.5" data-testid="learned-facts">
              {facts.map((f) => {
                const answer = memory.facts[f.id];
                return (
                  <li key={f.id} data-fact={f.id} data-answer={answer ?? "open"} className="text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="font-medium">{f.confidence < SURE ? t("ux.learned.maybe", { fact: f.title }) : tm(f.title)}</span>
                      <span className="num text-[11px] text-ink-2">
                        {answer === "confirmed" ? t("ux.learned.confirmed") : f.confidence < SURE ? t("statement.confidence", { p: f.confidence }) : ""}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {answer !== "confirmed" && (
                        <button type="button" className={`${pill} bg-ink text-bg`} onClick={() => { setNoted(f.id); onAnswer(f, "confirmed"); }}
                          aria-label={t("ux.learned.confirmAria", { fact: f.title })}>
                          {t("statement.confirm")}
                        </button>
                      )}
                      <button type="button" className={pill} onClick={() => onAnswer(f, "rejected")} aria-label={t("ux.learned.rejectAria", { fact: f.title })}>
                        {t("statement.reject")}
                      </button>
                      <details className="disclosure min-w-0 flex-1 basis-full">
                        <summary className="text-[11px] font-medium text-ink-2 hover:text-ink">{t("statement.evidence", { count: f.evidence.length })}</summary>
                        <ul className="num mt-1.5 space-y-0.5 text-[11px] text-ink-2">
                          {f.reasons.map((r, i) => <li key={`r${i}`} className="font-sans">{tm(r)}</li>)}
                          {f.evidence.slice(0, EVIDENCE_SHOWN).map((id) => {
                            const row = evidence.get(id);
                            return row ? (
                              <li key={id} className="flex justify-between gap-2">
                                <span className="min-w-0 truncate">{dateCh(row.date)} · {tm(merchantText(row.merchant))}</span>
                                <span className="shrink-0">{receiptMoney(row.signed)}</span>
                              </li>
                            ) : null;
                          })}
                          {f.evidence.length > EVIDENCE_SHOWN && <li>{t("ux.learned.more", { count: f.evidence.length - EVIDENCE_SHOWN })}</li>}
                        </ul>
                      </details>
                    </div>
                    <div role="status">
                      {noted === f.id && answer === "confirmed" && <p className="mt-1 text-good">{t(`ux.learned.did.${f.id}` as MessageKey, { amount: f.monthlyAmount })}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <Disclosure summary={t("common.details")} className="mt-2.5" testId="learned-details">
            <div className="space-y-3 text-xs">
              <ul className="space-y-1 text-ink" data-testid="learned-headline">
                {summary.headline.map((line, i) => (
                  <li key={i} className={i === 0 ? "num text-[11px] text-ink-2" : ""}>{tm(line)}</li>
                ))}
                {profileIncome !== null && (
                  <li data-learned="income">{t("ux.learned.profileIncome", { amount: profileIncome })}</li>
                )}
              </ul>
              <p className="text-ink-2">{t("statement.intro")}</p>
              {summary.fixed.items.length > 0 && (
                <div>
                  <div className="label mb-1">{t("ux.learned.fixed")}</div>
                  <ul className="num space-y-0.5">
                    {summary.fixed.items.map((item) => (
                      <li key={`${item.kind}-${item.merchant}`} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {tm(merchantText(item.merchant))}
                          <span className="text-ink-2"> · {t(`statement.kind.${item.kind}`)} · {t(`statement.cadence.${item.cadence}`)}</span>
                        </span>
                        <span className="shrink-0">{t("ux.learned.perMonth", { amount: item.monthlyAmount })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.variable.byCategory.length > 0 && (
                <div>
                  <div className="label mb-1">{t("ux.learned.flexible")}</div>
                  <ul className="num space-y-0.5">
                    {summary.variable.byCategory.map((c) => (
                      <li key={c.category} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">{tm(categoryMsg(c.category))} <span className="text-ink-2">· {fmt.pct(c.share)}</span></span>
                        <span className="shrink-0">{t("ux.learned.perMonth", { amount: c.monthlyAvg })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(rejected > 0 || Object.keys(memory.facts).length > 0) && (
                <button type="button" className={pill} onClick={onForget}>{t("ux.learned.askAgain")}</button>
              )}
            </div>
          </Disclosure>
        </>
      )}
    </div>
  );
}
