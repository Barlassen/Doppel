"use client";

import { categoryMsg } from "@/lib/data/merchants";
import type { BehaviorProfile } from "@/lib/finance/behavioralEngine";
import type { Profile, TransactionCategory } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { msg, type Msg } from "@/lib/i18n/types";

/** One line of "What the twin learned": a label, its value and an optional short qualifier. */
export interface LearnedRow {
  id: "income" | "fixed" | "flexible" | "saving" | "habits";
  label: Msg;
  value: Msg;
  note?: Msg;
}

export interface Learned {
  /** What the rows are based on. `months` is 0 when the account has no transaction history. */
  basis: { transactions: number; trades: number; months: number };
  rows: LearnedRow[];
}

/** Costs that come back every month whatever the month looks like. */
const FIXED: ReadonlySet<TransactionCategory> = new Set(["housing", "insurance", "bills", "subscriptions"]);
/** How many flexible categories and habits one row lists. */
const TOP = 3;

/**
 * THE adapter of the panel: the account's data (profile + behaviour analysis) → rows. Everything the panel shows comes
 * from here, so a richer statement summary (e.g. `summarizeStatement()` in src/lib/import) can replace or extend the
 * rows in this one function without touching the component.
 */
export function learnedFrom(profile: Profile, behavior: BehaviorProfile): Learned {
  const tx = profile.transactions;
  const months = new Set(tx.map((t) => t.date.slice(0, 7))).size;
  const basis = { transactions: tx.length, trades: profile.trades.length, months };
  if (!months) return { basis, rows: [] };

  const byCategory = new Map<TransactionCategory, number>();
  for (const t of tx) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
  const perMonth = [...byCategory].map(([category, sum]) => ({ category, amount: sum / months }));
  const fixed = perMonth.filter((c) => FIXED.has(c.category));
  const flexible = perMonth.filter((c) => !FIXED.has(c.category) && c.category !== "investing" && c.amount > 0).sort((a, b) => b.amount - a.amount);
  const left = profile.netIncomeMonth - profile.expensesMonth;

  const rows: LearnedRow[] = [
    {
      id: "income",
      label: msg("ux.learned.income"),
      value: msg("ux.learned.perMonth", { amount: profile.netIncomeMonth }),
      // Statements do not set the income yet: it is the profile's take-home pay.
      note: msg("ux.learned.fromProfile"),
    },
    {
      id: "fixed",
      label: msg("ux.learned.fixed"),
      value: msg("ux.learned.perMonth", { amount: fixed.reduce((s, c) => s + c.amount, 0) }),
      note: profile.rentMonth > 0 ? msg("ux.learned.rent", { amount: profile.rentMonth }) : undefined,
    },
    ...(flexible.length
      ? [{
          id: "flexible" as const,
          label: msg("ux.learned.flexible"),
          value: msg("ux.learned.list", { items: flexible.slice(0, TOP).map((c) => msg("ux.learned.category", { category: categoryMsg(c.category), amount: c.amount })) }),
        }]
      : []),
    {
      id: "saving",
      label: msg("ux.learned.saving"),
      value: profile.netIncomeMonth > 0 && left > 0
        ? msg("ux.learned.savingRate", { rate: left / profile.netIncomeMonth, amount: left })
        : msg("ux.learned.savingNone"),
      note: left > 0 ? msg("ux.learned.invested", { share: profile.investShare }) : undefined,
    },
    ...(behavior.insights.length
      ? [{
          id: "habits" as const,
          label: msg("ux.learned.habits"),
          value: msg("ux.learned.list", { items: behavior.insights.slice(0, TOP).map((i) => i.title) }),
        }]
      : []),
  ];
  return { basis, rows };
}

/** "What the twin learned": the short result of the account's statements (rows from `learnedFrom`). */
export function LearnedPanel({ learned, fresh }: { learned: Learned; fresh?: boolean }) {
  const { t, tm } = useI18n();
  const { basis, rows } = learned;
  return (
    <div className={`rounded-xl px-3 py-2.5 ${fresh ? "bg-good/10" : "bg-surface-2"}`} data-testid="learned">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-sm font-semibold">{t("ux.learned.title")}</h4>
        {rows.length > 0 && (
          <span className="num text-[11px] text-ink-2">
            {t(basis.trades > 0 ? "ux.learned.basisTrades" : "ux.learned.basis", { transactions: basis.transactions, months: basis.months, trades: basis.trades })}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-ink-2">{t("ux.learned.empty")}</p>
      ) : (
        <dl className="mt-2 space-y-1.5 text-xs">
          {rows.map((r) => (
            <div key={r.id} data-learned={r.id}>
              <dt className="text-ink-2">{tm(r.label)}</dt>
              <dd className="num font-medium text-ink">
                {tm(r.value)}
                {r.note && <span className="font-normal text-ink-2"> · {tm(r.note)}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
