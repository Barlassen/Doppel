"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from "react";
import {
  addImport,
  categoryOverrides,
  importedRefs,
  listImports,
  listTrades,
  listTransactions,
  undoImport,
  type Account,
} from "@/lib/accounts";
import { categoryMsg } from "@/lib/data/merchants";
import { TRANSACTION_CATEGORIES, type TransactionCategory } from "@/lib/finance/types";
import type { LedgerEntry } from "@/lib/frugal/ledger";
import { msg, type Msg, type Text } from "@/lib/i18n/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {
  BANK_PROFILES,
  BROKER_PROFILES,
  guessBankMapping,
  guessTradeMapping,
  parseBankManual,
  parseTradesManual,
  readStatement,
  type BankMapping,
  type CsvTable,
  type ParsedStatement,
  type ReviewRow,
  type TradeMapping,
} from "@/lib/import";
import { categorizeWithModel } from "@/lib/import/categorizeClient";
import { buildReview, finalizeReview, isAdded, reviewCounts, reviewOverrides, setRowCategory, type Review } from "@/lib/import/review";
import { CardHeader, Disclosure } from "./ui";

/** Sample files generated from the built-in accounts (scripts/make-import-samples.ts). */
export const IMPORT_SAMPLES = [
  { account: "Barlas", file: "barlas-zkb.csv", provider: "ZKB", format: "CSV" },
  { account: "Barlas", file: "barlas-viac-3a.csv", provider: "VIAC", format: "CSV" },
  { account: "Barlas", file: "barlas-ibkr.csv", provider: "IBKR", format: "CSV" },
  { account: "Meriç", file: "meric-postfinance.camt053.xml", provider: "PostFinance", format: "camt.053" },
  { account: "Meriç", file: "meric-swissquote.csv", provider: "Swissquote", format: "CSV" },
  { account: "Oktay", file: "oktay-neon.csv", provider: "neon", format: "CSV" },
  { account: "Oktay", file: "oktay-revolut.csv", provider: "Revolut", format: "CSV" },
] as const;

const PROFILE_NAMES: Record<string, string> = Object.fromEntries([
  ...BANK_PROFILES.map((p) => [p.id, p.name]),
  ...BROKER_PROFILES.map((p) => [p.id, p.name]),
  ["ibkr", "Interactive Brokers"],
  ["camt.053", "ISO 20022 camt.053"],
  ["camt.054", "ISO 20022 camt.054"],
]);

const field = "w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";
const pill = "rounded-full border border-line px-3 py-1.5 text-xs font-medium enabled:hover:border-ink-3 disabled:opacity-45";
const primary = "rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-45";

type Filter = "new" | "review" | "duplicates" | "excluded" | "trades";

interface Pending {
  fileName: string;
  parsed: ParsedStatement;
  review: Review;
  /** Rows the local rules resolved (for the ledger line). */
  categorizing: boolean;
  modelNote?: Msg;
}

interface Mapping {
  fileName: string;
  table: CsvTable;
  kind: "transactions" | "trades";
  bank: BankMapping;
  trade: TradeMapping;
}

export function ImportPanel({
  account,
  onLedger,
  onDataChange,
  openToken,
}: {
  account: Account;
  onLedger: (entry: LedgerEntry) => void;
  /** Called right before the store changes, with the label for the hero's impact line. */
  onDataChange: (label: Text) => void;
  /** Changing this number scrolls the panel into view and opens the file picker (wizard's import step). */
  openToken?: number;
}) {
  const { t, tm, fmt } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [error, setError] = useState<Msg | null>(null);
  const [done, setDone] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const accountId = account.id;
  const imports = useMemo(() => listImports(accountId), [accountId, account.version]); // eslint-disable-line react-hooks/exhaustive-deps -- version tracks store writes

  // A different account: drop any half-finished import.
  useEffect(() => {
    setPending(null);
    setMapping(null);
    setError(null);
    setDone(null);
  }, [accountId]);

  useEffect(() => {
    if (!openToken) return;
    root.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    input.current?.click();
  }, [openToken]);

  useEffect(() => {
    if (pending && !pending.categorizing) reviewHeading.current?.focus();
  }, [pending?.fileName, pending?.categorizing]); // eslint-disable-line react-hooks/exhaustive-deps -- focus once per review

  async function startReview(fileName: string, parsed: ParsedStatement) {
    const review = buildReview(
      parsed,
      { transactions: listTransactions(accountId), trades: listTrades(accountId), refs: importedRefs(accountId) },
      categoryOverrides(accountId),
    );
    const local = review.rows.filter((r) => isAdded(r) && r.source !== "fallback").length;
    setMapping(null);
    setPending({ fileName, parsed, review, categorizing: true });
    const outcome = await categorizeWithModel(review, fileName, local);
    outcome.entries.forEach(onLedger);
    const modelNote =
      outcome.mode === "model" ? msg("data.modelUsed", { count: outcome.sent })
        : outcome.mode === "offline" ? msg("data.modelOffline", { count: outcome.sent })
          : outcome.mode === "error" ? msg("data.modelError", { count: outcome.sent })
            : msg("data.allLocal");
    setPending((p) => (p && p.fileName === fileName ? { ...p, review: outcome.review, categorizing: false, modelNote } : p));
  }

  async function handle(fileName: string, bytes: Uint8Array) {
    setError(null);
    setDone(null);
    setPending(null);
    setMapping(null);
    const result = readStatement(fileName, bytes);
    if (result.kind === "error") return setError(result.error);
    if (result.kind === "mapping") {
      return setMapping({ fileName, table: result.table, kind: "transactions", bank: guessBankMapping(result.table), trade: guessTradeMapping(result.table) });
    }
    if (!result.parsed.rows.length && !result.parsed.trades.length) return setError(msg("data.noRows"));
    await startReview(fileName, result.parsed);
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await handle(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch {
      setError(msg("data.unreadable"));
    } finally {
      setBusy(false);
    }
  }

  async function sample(file: string) {
    setBusy(true);
    try {
      const res = await fetch(`/samples/imports/${file}`);
      if (!res.ok) throw new Error(String(res.status));
      await handle(file, new Uint8Array(await res.arrayBuffer()));
    } catch {
      setError(msg("data.unreadable"));
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!pending || pending.categorizing) return;
    const counts = reviewCounts(pending.review);
    const out = finalizeReview(pending.review);
    if (!out.transactions.length && !out.trades.length) return;
    onDataChange(msg("data.impactImport", { file: pending.fileName }));
    addImport(accountId, {
      fileName: pending.fileName,
      format: pending.parsed.format,
      profile: pending.parsed.profile,
      counts,
      transactions: out.transactions,
      refs: out.refs,
      trades: out.trades,
      overrides: reviewOverrides(pending.review),
    });
    setDone(msg("data.imported", { transactions: counts.transactions, trades: counts.trades, file: pending.fileName }));
    setPending(null);
  }

  function undo(id: string, fileName: string) {
    onDataChange(msg("data.impactUndo", { file: fileName }));
    undoImport(accountId, id);
    setDone(msg("data.undone", { file: fileName }));
  }

  const disabled = busy || !!pending?.categorizing;
  return (
    <section ref={root} className="card min-w-0 scroll-mt-24 p-5 sm:p-6" aria-labelledby="import-title">
      <CardHeader title={<span id="import-title">{t("data.importTitle")}</span>} />
      <p className="mb-4 text-sm text-ink-2">{t("data.importIntro")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primary} disabled={disabled} onClick={() => input.current?.click()}>
          {t("data.chooseFile")}
        </button>
        <span className="text-xs text-ink-3">{t("data.formats")}</span>
      </div>
      <input ref={input} type="file" accept=".csv,.txt,.xml,text/csv,application/xml,text/xml" className="hidden"
        aria-label={t("data.chooseFile")} onChange={pick} />

      <Disclosure summary={t("data.samples")} className="mt-3">
        <p className="mb-2 text-xs text-ink-2">{t("data.samplesHint")}</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {IMPORT_SAMPLES.map((s) => (
            <li key={s.file}>
              <button type="button" disabled={disabled} onClick={() => void sample(s.file)}
                aria-label={t("data.sampleAria", { account: s.account, provider: s.provider, format: s.format })}
                className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left text-xs enabled:hover:border-ink-3 disabled:opacity-50">
                <span className="min-w-0 truncate"><b className="font-medium">{s.account}</b> · {s.provider}</span>
                <span className="shrink-0 text-ink-3">{s.format}</span>
              </button>
            </li>
          ))}
        </ul>
      </Disclosure>

      <div role="status" className="text-sm">
        {busy && !pending && <p className="mt-3 text-ink-2">{t("data.reading")}</p>}
        {done && <p className="mt-3 text-good">{tm(done)}</p>}
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-bad">{tm(error)}</p>}

      {mapping && (
        <MappingForm mapping={mapping} onChange={setMapping} onCancel={() => setMapping(null)}
          onSubmit={(m) => {
            const parsed = m.kind === "transactions" ? parseBankManual(m.table, m.bank) : parseTradesManual(m.table, m.trade);
            if (!parsed.rows.length && !parsed.trades.length) return setError(msg("data.noRows"));
            setError(null);
            void startReview(m.fileName, parsed);
          }} />
      )}

      {pending && (
        <ReviewTable pending={pending} headingRef={reviewHeading}
          onCategory={(rowId, c) => setPending((p) => (p ? { ...p, review: setRowCategory(p.review, rowId, c) } : p))}
          onCancel={() => setPending(null)} onConfirm={confirm} />
      )}

      {imports.length > 0 && (
        <Disclosure summary={t("data.history", { count: imports.length })} className="mt-4">
          <ul className="space-y-2">
            {[...imports].reverse().map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
                <span className="min-w-0">
                  <span className="block truncate font-medium" title={r.fileName}>{r.fileName}</span>
                  <span className="block text-ink-3">
                    {fmt.ym(Number(r.at.slice(0, 4)) * 100 + Number(r.at.slice(5, 7)))}{" · "}
                    {t("data.historyCounts", { transactions: r.counts.transactions, trades: r.counts.trades, duplicates: r.counts.duplicates })}
                  </span>
                </span>
                <button type="button" className={pill} onClick={() => undo(r.id, r.fileName)} aria-label={t("data.undoAria", { file: r.fileName })}>
                  {t("data.undo")}
                </button>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

// ---------------- review ----------------

function ReviewTable({ pending, headingRef, onCategory, onCancel, onConfirm }: {
  pending: Pending;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onCategory: (rowId: string, c: TransactionCategory) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, tm, fmt } = useI18n();
  const { review, parsed, fileName, categorizing } = pending;
  const counts = reviewCounts(review);
  const [filter, setFilter] = useState<Filter>(() => (review.rows.length ? "new" : "trades"));
  const rows = review.rows.filter((r) =>
    filter === "new" ? isAdded(r) : filter === "review" ? isAdded(r) && r.needsReview : filter === "duplicates" ? r.duplicate : filter === "excluded" ? !isAdded(r) && !r.duplicate : false,
  );
  const filters: { id: Filter; count: number }[] = [
    { id: "new", count: counts.transactions },
    { id: "review", count: counts.review },
    { id: "duplicates", count: review.rows.filter((r) => r.duplicate).length },
    { id: "excluded", count: counts.income + counts.transfers },
    { id: "trades", count: review.trades.length },
  ];
  const skippedForeign = review.skipped.filter((s) => s.reason === "foreignCurrency");
  const profileName = PROFILE_NAMES[parsed.profile] ?? parsed.profile;
  const nothing = counts.transactions + counts.trades === 0;

  return (
    <form aria-label={t("data.reviewAria")} onSubmit={(e) => { e.preventDefault(); onConfirm(); }}
      className="mt-4 min-w-0 space-y-3 rounded-xl border border-line bg-surface-2 p-3">
      <div>
        <h3 ref={headingRef} tabIndex={-1} className="break-words text-sm font-semibold">{t("data.reviewHeading", { file: fileName })}</h3>
        <p className="mt-0.5 text-xs text-ink-2">
          {parsed.profile === "manual" ? t("data.manualLayout")
            : parsed.format.startsWith("camt") ? t("data.camtLayout", { format: parsed.format })
              : t("data.profileLayout", { name: profileName })}
        </p>
      </div>

      <p className="num text-xs text-ink-2" data-testid="import-counts">
        {t("data.counts", { transactions: counts.transactions, trades: counts.trades, duplicates: counts.duplicates, income: counts.income, transfers: counts.transfers, review: counts.review })}
      </p>
      <div role="status" className="text-xs">
        {categorizing ? <p className="text-ink-2">{t("data.categorizing")}</p> : pending.modelNote && <p className="text-ink-2">{tm(pending.modelNote)}</p>}
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label={t("data.filterAria")}>
        {filters.filter((f) => f.count > 0 || f.id === "new").map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${filter === f.id ? "bg-ink text-bg" : "border border-line text-ink-2 hover:text-ink"}`}>
            {t(`data.filter.${f.id}`)} <span className="num">{fmt.int(f.count)}</span>
          </button>
        ))}
      </div>

      {filter === "trades" ? (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {review.trades.map((r) => (
            <li key={r.id} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-md bg-surface px-2 py-1.5 text-xs ${r.duplicate ? "opacity-55" : ""}`}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.trade.instrument}</span>
                <span className="block text-ink-3">
                  {r.trade.date} · {t(`data.side.${r.trade.side}`)} · {t(`data.tradeAccount.${r.trade.account}`)}
                  {r.duplicate && <> · {t("data.duplicate")}</>}
                </span>
              </span>
              <span className="num self-center">{fmt.chf(r.trade.amount)}</span>
            </li>
          ))}
        </ul>
      ) : rows.length ? (
        <div className="max-h-96 overflow-y-auto rounded-md bg-surface">
          <table className="w-full table-fixed text-xs">
            <thead className="sticky top-0 bg-surface text-left text-[11px] text-ink-3">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">{t("data.colMerchant")}</th>
                <th scope="col" className="w-[4.75rem] px-1 py-1.5 text-right font-medium sm:w-24">{t("data.colAmount")}</th>
                <th scope="col" className="w-[7.5rem] px-2 py-1.5 font-medium sm:w-40">{t("data.colCategory")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} row={r} onCategory={onCategory} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-ink-2">{t("data.emptyFilter")}</p>
      )}

      {(review.notes.length > 0 || review.skipped.length > 0) && (
        <Disclosure summary={t("data.skipped", { count: review.skipped.length })}>
          <ul className="space-y-1 text-xs text-ink-2">
            {review.notes.map((n, i) => <li key={i}>{tm(n)}</li>)}
            {skippedForeign.length > 0 && (
              <li>{t("data.skipForeign", { count: skippedForeign.length, currencies: [...new Set(skippedForeign.map((s) => s.currency ?? "?"))].join(", ") })}</li>
            )}
            {(["pending", "notATrade", "badDate", "badAmount", "zero"] as const).map((reason) => {
              const n = review.skipped.filter((s) => s.reason === reason).length;
              return n ? <li key={reason}>{t(`data.skip.${reason}`, { count: n })}</li> : null;
            })}
          </ul>
        </Disclosure>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={pill}>{t("data.cancel")}</button>
        <button type="submit" disabled={categorizing || nothing} className={primary}>
          {nothing ? t("data.nothingNew") : t("data.confirm", { count: counts.transactions + counts.trades })}
        </button>
      </div>
    </form>
  );
}

function Row({ row, onCategory }: { row: ReviewRow; onCategory: (rowId: string, c: TransactionCategory) => void }) {
  const { t, tm, fmt } = useI18n();
  const counted = row.kind === "spend" || row.kind === "refund";
  return (
    <tr className={`border-t border-line align-top ${row.duplicate ? "opacity-55" : ""}`}>
      <td className="min-w-0 px-2 py-1.5">
        <span className="block truncate font-medium" title={row.raw}>{row.merchant}</span>
        <span className="block truncate text-[11px] text-ink-3">
          {row.date}
          {row.duplicate ? <> · {t("data.duplicate")}</> : !counted ? <> · {t(`data.kind.${row.kind}`)}</> : row.kind === "refund" ? <> · {t("data.kind.refund")}</> : null}
          {row.needsReview && !row.duplicate && <> · <span className="text-warn">{t("data.needsReview")}</span></>}
        </span>
      </td>
      <td className="num px-1 py-1.5 text-right">{fmt.num(-row.amount, 2)}</td>
      <td className="px-2 py-1">
        {counted && !row.duplicate ? (
          <select className={`${field} py-1 text-xs ${row.needsReview ? "border-warn" : ""}`} value={row.category}
            aria-label={t("data.categoryAria", { merchant: row.merchant, date: row.date })}
            onChange={(e) => onCategory(row.id, e.currentTarget.value as TransactionCategory)}>
            {TRANSACTION_CATEGORIES.map((c) => <option key={c} value={c}>{tm(categoryMsg(c))}</option>)}
          </select>
        ) : (
          <span className="text-[11px] text-ink-3">{counted ? tm(categoryMsg(row.category)) : "—"}</span>
        )}
      </td>
    </tr>
  );
}

// ---------------- manual column mapping ----------------

function MappingForm({ mapping, onChange, onSubmit, onCancel }: {
  mapping: Mapping;
  onChange: (m: Mapping) => void;
  onSubmit: (m: Mapping) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { table, kind, bank, trade } = mapping;
  const options = (optional: boolean) => (
    <>
      {optional && <option value={-1}>{t("data.mapNone")}</option>}
      {table.headers.map((h, i) => <option key={i} value={i}>{h || t("data.mapColumn", { n: i + 1 })}</option>)}
    </>
  );
  const num = (v: string) => Number(v);
  const opt = (v: string) => (num(v) >= 0 ? num(v) : undefined);
  const amountMode = bank.amount !== undefined ? "signed" : "split";
  const select = (label: string, value: number | undefined, optional: boolean, set: (v: string) => void) => (
    <label className="min-w-0 text-xs font-medium text-ink-2">
      {label}
      <select className={`${field} mt-1`} value={value ?? -1} onChange={(e) => set(e.currentTarget.value)}>{options(optional)}</select>
    </label>
  );
  const valid = kind === "transactions"
    ? bank.date >= 0 && bank.description.length > 0 && (bank.amount !== undefined || bank.debit !== undefined || bank.credit !== undefined)
    : trade.date >= 0 && trade.instrument >= 0 && trade.amount >= 0;

  return (
    <form aria-label={t("data.mapAria")} onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(mapping); }}
      className="mt-4 min-w-0 space-y-3 rounded-xl border border-line bg-surface-2 p-3">
      <div>
        <h3 className="break-words text-sm font-semibold">{t("data.mapHeading", { file: mapping.fileName })}</h3>
        <p className="mt-0.5 text-xs text-ink-2">{t("data.mapIntro")}</p>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("data.mapKind")}>
        {(["transactions", "trades"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => onChange({ ...mapping, kind: k })}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${kind === k ? "bg-ink text-bg" : "border border-line text-ink-2 hover:text-ink"}`}>
            {t(`data.mapKinds.${k}`)}
          </button>
        ))}
      </div>
      {kind === "transactions" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {select(t("data.mapDate"), bank.date, false, (v) => onChange({ ...mapping, bank: { ...bank, date: num(v) } }))}
          {select(t("data.mapDescription"), bank.description[0], false, (v) => onChange({ ...mapping, bank: { ...bank, description: num(v) >= 0 ? [num(v)] : [] } }))}
          <fieldset className="min-w-0 sm:col-span-2">
            <legend className="text-xs font-medium text-ink-2">{t("data.mapAmountMode")}</legend>
            <div className="mt-1 flex flex-wrap gap-3 text-xs">
              {(["signed", "split"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input type="radio" name="amount-mode" checked={amountMode === m}
                    onChange={() => onChange({ ...mapping, bank: m === "signed" ? { ...bank, amount: bank.debit ?? bank.credit ?? 0, debit: undefined, credit: undefined } : { ...bank, amount: undefined, debit: bank.amount ?? 0, credit: undefined } })} />
                  {t(`data.mapModes.${m}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {amountMode === "signed" ? (
            <>
              {select(t("data.mapAmount"), bank.amount, false, (v) => onChange({ ...mapping, bank: { ...bank, amount: num(v) } }))}
              <label className="flex items-center gap-1.5 self-end pb-2 text-xs text-ink-2">
                <input type="checkbox" checked={!!bank.invert} onChange={(e) => onChange({ ...mapping, bank: { ...bank, invert: e.currentTarget.checked } })} />
                {t("data.mapInvert")}
              </label>
            </>
          ) : (
            <>
              {select(t("data.mapDebit"), bank.debit, true, (v) => onChange({ ...mapping, bank: { ...bank, debit: opt(v) } }))}
              {select(t("data.mapCredit"), bank.credit, true, (v) => onChange({ ...mapping, bank: { ...bank, credit: opt(v) } }))}
            </>
          )}
          {select(t("data.mapCurrency"), bank.currency, true, (v) => onChange({ ...mapping, bank: { ...bank, currency: opt(v) } }))}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-xs font-medium text-ink-2">
            {t("data.mapAccount")}
            <select className={`${field} mt-1`} value={trade.account} onChange={(e) => onChange({ ...mapping, trade: { ...trade, account: e.currentTarget.value as TradeMapping["account"] } })}>
              <option value="broker">{t("data.tradeAccount.broker")}</option>
              <option value="3a">{t("data.tradeAccount.3a")}</option>
            </select>
          </label>
          {select(t("data.mapDate"), trade.date, false, (v) => onChange({ ...mapping, trade: { ...trade, date: num(v) } }))}
          {select(t("data.mapInstrument"), trade.instrument, false, (v) => onChange({ ...mapping, trade: { ...trade, instrument: num(v) } }))}
          {select(t("data.mapTradeAmount"), trade.amount, false, (v) => onChange({ ...mapping, trade: { ...trade, amount: num(v) } }))}
          {select(t("data.mapSide"), trade.side, true, (v) => onChange({ ...mapping, trade: { ...trade, side: opt(v) } }))}
          {select(t("data.mapUnits"), trade.units, true, (v) => onChange({ ...mapping, trade: { ...trade, units: opt(v) } }))}
          {select(t("data.mapPrice"), trade.price, true, (v) => onChange({ ...mapping, trade: { ...trade, price: opt(v) } }))}
          {select(t("data.mapCurrency"), trade.currency, true, (v) => onChange({ ...mapping, trade: { ...trade, currency: opt(v) } }))}
        </div>
      )}
      <p className="text-[11px] text-ink-3">{t("data.mapPreview", { rows: table.rows.length })}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={pill}>{t("data.cancel")}</button>
        <button type="submit" disabled={!valid} className={primary}>{t("data.mapContinue")}</button>
      </div>
    </form>
  );
}
