"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addTrade,
  addTransaction,
  deleteTrade,
  deleteTransaction,
  listTrades,
  listTransactions,
  updateTrade,
  updateTransaction,
  type Account,
} from "@/lib/accounts";
import type { AccountRecord } from "@/lib/accounts/types";
import { categoryMsg, merchantText } from "@/lib/data/merchants";
import { TRANSACTION_CATEGORIES, type InvestmentTrade, type ReceiptItem, type Transaction, type TransactionCategory } from "@/lib/finance/types";
import { msg, type Text } from "@/lib/i18n/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { ReceiptDetails } from "./ReceiptDetails";
import { CardHeader } from "./ui";

const field = "w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";
const pill = "rounded-full border border-line px-3 py-1.5 text-xs font-medium enabled:hover:border-ink-3 disabled:opacity-45";
const primary = "rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-45";
const iconBtn = "grid size-7 shrink-0 place-items-center rounded-md border border-line text-xs text-ink-2 hover:border-ink-3 hover:text-ink";

const MAX = 1_000_000;
const ymNum = (ym: string) => Number(ym.slice(0, 4)) * 100 + Number(ym.slice(5, 7));
const today = () => new Date().toISOString().slice(0, 10);
const validDate = (d: string) => /^\d{4}-\d\d-\d\d$/.test(d) && Number.isFinite(new Date(d).getTime());

/**
 * The active account's transactions and trades: by month with category and month filters, add / edit / delete,
 * receipt items shown and editable. Every change goes through the accounts store, so the twin recomputes at once.
 */
export function TransactionsPanel({ account, onDataChange }: { account: Account; onDataChange: (label: Text) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"transactions" | "trades">("transactions");
  const txCount = account.profile.transactions.length;
  const tradeCount = account.profile.trades.length;
  return (
    <section className="card min-w-0 p-5 sm:p-6" aria-labelledby="tx-title">
      <CardHeader
        title={<span id="tx-title">{t("data.txTitle")}</span>}
        aside={
          <div className="flex rounded-full border border-line p-0.5 text-[11px]" role="group" aria-label={t("data.txTabs")}>
            {(["transactions", "trades"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
                className={`rounded-full px-2.5 py-1 font-medium ${tab === k ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}>
                {t(`data.tab.${k}`, { count: k === "transactions" ? txCount : tradeCount })}
              </button>
            ))}
          </div>
        }
      />
      {tab === "transactions" ? <TransactionList account={account} onDataChange={onDataChange} /> : <TradeList account={account} onDataChange={onDataChange} />}
    </section>
  );
}

// ---------------- transactions ----------------

function TransactionList({ account, onDataChange }: { account: Account; onDataChange: (label: Text) => void }) {
  const { t, tm, fmt } = useI18n();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the account version changes with every store write
  const records = useMemo(() => listTransactions(account.id), [account.id, account.version]);
  const months = useMemo(() => [...new Set(records.map((r) => r.value.date.slice(0, 7)))].sort().reverse(), [records]);
  const [month, setMonth] = useState<string>("latest");
  const [category, setCategory] = useState<TransactionCategory | "all">("all");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const shownMonth = month === "latest" ? months[0] ?? "all" : month;
  const shown = records
    .filter((r) => (shownMonth === "all" || r.value.date.startsWith(shownMonth)) && (category === "all" || r.value.category === category))
    .sort((a, b) => (a.value.date < b.value.date ? 1 : a.value.date > b.value.date ? -1 : 0));
  const groups = new Map<string, AccountRecord<Transaction>[]>();
  for (const r of shown) groups.set(r.value.date.slice(0, 7), [...(groups.get(r.value.date.slice(0, 7)) ?? []), r]);
  const present = new Set(records.map((r) => r.value.category));

  useEffect(() => setEditing(null), [account.id]);

  function save(id: string | "new", tx: Transaction) {
    if (id === "new") {
      onDataChange(msg("data.impactAdd", { merchant: tx.merchant }));
      addTransaction(account.id, tx);
    } else {
      onDataChange(msg("data.impactEdit", { merchant: tx.merchant }));
      updateTransaction(account.id, id, { ...tx, items: tx.items });
    }
    setEditing(null);
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="min-w-0 text-xs font-medium text-ink-2">
          {t("data.filterMonth")}
          <select className={`${field} mt-1`} value={month} onChange={(e) => setMonth(e.currentTarget.value)}>
            <option value="latest">{t("data.latestMonth")}</option>
            <option value="all">{t("data.allMonths")}</option>
            {months.map((m) => <option key={m} value={m}>{fmt.ym(ymNum(m))}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs font-medium text-ink-2">
          {t("data.filterCategory")}
          <select className={`${field} mt-1`} value={category} onChange={(e) => setCategory(e.currentTarget.value as TransactionCategory | "all")}>
            <option value="all">{t("data.allCategories")}</option>
            {TRANSACTION_CATEGORIES.filter((c) => present.has(c)).map((c) => <option key={c} value={c}>{tm(categoryMsg(c))}</option>)}
          </select>
        </label>
        <button type="button" className={`${primary} col-span-2 justify-self-start sm:col-span-1`} onClick={() => setEditing("new")} disabled={editing === "new"}>
          {t("data.addTx")}
        </button>
      </div>

      {editing === "new" && <TxEditor onSave={(tx) => save("new", tx)} onCancel={() => setEditing(null)} />}

      {account.receipts.length > 0 && (
        <details className="disclosure rounded-lg bg-surface-2 px-3 py-2">
          <summary className="text-xs font-medium text-ink-2">{t("data.receipts", { count: account.receipts.length })}</summary>
          <ul className="mt-2 space-y-2">
            {account.receipts.map((r, i) => (
              <li key={i} className="text-xs">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{r.date} · {tm(merchantText(r.merchant))} · {tm(categoryMsg(r.category))}</span>
                  <span className="num shrink-0">{fmt.chf(r.amount)}</span>
                </div>
                {!!r.items?.length && <ReceiptDetails items={r.items} total={r.amount} />}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-3">{t("data.receiptsNote")}</p>
        </details>
      )}

      {groups.size === 0 ? (
        <p className="text-sm text-ink-2">{records.length ? t("data.emptyFilter") : t("data.noTransactions")}</p>
      ) : (
        <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
          {[...groups].map(([m, rows]) => {
            const spend = rows.filter((r) => r.value.category !== "investing").reduce((s, r) => s + r.value.amount, 0);
            return (
              <div key={m}>
                <h4 className="label sticky top-0 z-10 flex justify-between bg-surface py-1">
                  <span>{fmt.ym(ymNum(m))}</span>
                  <span className="num">{t("data.monthSummary", { count: rows.length, amount: spend })}</span>
                </h4>
                <ul className="divide-y divide-line">
                  {rows.map((r) => (
                    <li key={r.id} className="py-1.5">
                      {editing === r.id ? (
                        <TxEditor initial={r.value} onSave={(tx) => save(r.id, tx)} onCancel={() => setEditing(null)} />
                      ) : (
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{tm(merchantText(r.value.merchant))}</span>
                            <span className="block truncate text-[11px] text-ink-3">
                              {r.value.date.slice(8, 10)}.{r.value.date.slice(5, 7)}. · {tm(categoryMsg(r.value.category))}
                              {r.value.note ? <> · {r.value.note}</> : null}
                            </span>
                            {!!r.value.items?.length && <ReceiptDetails items={r.value.items} total={r.value.amount} />}
                          </span>
                          <span className="num shrink-0 text-sm">{fmt.chf(r.value.amount)}</span>
                          <button type="button" className={iconBtn} aria-label={t("data.editAria", { merchant: r.value.merchant, date: r.value.date })} onClick={() => setEditing(r.id)}>✎</button>
                          <button type="button" className={iconBtn} aria-label={t("data.deleteAria", { merchant: r.value.merchant, date: r.value.date })}
                            onClick={() => {
                              onDataChange(msg("data.impactDelete", { merchant: r.value.merchant }));
                              deleteTransaction(account.id, r.id);
                            }}>✕</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ItemRow {
  id: number;
  name: string;
  amount: string;
}

function TxEditor({ initial, onSave, onCancel }: { initial?: Transaction; onSave: (tx: Transaction) => void; onCancel: () => void }) {
  const { t, tm } = useI18n();
  const [date, setDate] = useState(initial?.date ?? today());
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [category, setCategory] = useState<TransactionCategory>(initial?.category ?? "groceries");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const nextId = useRef(0);
  const [items, setItems] = useState<ItemRow[]>(() => (initial?.items ?? []).map((it) => ({ id: nextId.current++, name: it.name, amount: String(it.amount) })));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const value = Number(amount);
  const itemsValid = items.every((it) => it.name.trim() && Number.isFinite(Number(it.amount)) && it.amount !== "");
  const valid = validDate(date) && merchant.trim().length > 0 && amount !== "" && Number.isFinite(value) && value !== 0 && Math.abs(value) <= MAX && itemsValid;
  const itemSum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  return (
    <form aria-label={initial ? t("data.editTx") : t("data.addTx")} className="space-y-2 rounded-lg border border-line bg-surface-2 p-3"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const parsedItems: ReceiptItem[] = items.map((it) => ({ name: it.name.trim(), amount: Number(it.amount) }));
        onSave({
          date,
          merchant: merchant.trim().slice(0, 80),
          category,
          amount: Math.round(value * 100) / 100,
          ...(note.trim() ? { note: note.trim().slice(0, 120) } : {}),
          ...(parsedItems.length ? { items: parsedItems } : {}),
        });
      }}>
      <div className="grid grid-cols-2 gap-2 text-xs font-medium text-ink-2">
        <label className="col-span-2 min-w-0 sm:col-span-1">
          {t("data.fieldMerchant")}
          <input ref={first} className={`${field} mt-1`} required maxLength={80} value={merchant} onChange={(e) => setMerchant(e.currentTarget.value)} />
        </label>
        <label className="min-w-0">
          {t("data.fieldDate")}
          <input className={`${field} mt-1`} type="date" required value={date} onChange={(e) => setDate(e.currentTarget.value)} />
        </label>
        <label className="min-w-0">
          {t("data.fieldAmount")}
          <input className={`${field} mt-1`} type="number" inputMode="decimal" step="0.01" min={-MAX} max={MAX} required value={amount} onChange={(e) => setAmount(e.currentTarget.value)} />
        </label>
        <label className="min-w-0">
          {t("data.fieldCategory")}
          <select className={`${field} mt-1`} value={category} onChange={(e) => setCategory(e.currentTarget.value as TransactionCategory)}>
            {TRANSACTION_CATEGORIES.map((c) => <option key={c} value={c}>{tm(categoryMsg(c))}</option>)}
          </select>
        </label>
        <label className="col-span-2 min-w-0">
          {t("data.fieldNote")}
          <input className={`${field} mt-1`} maxLength={120} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        </label>
      </div>
      <fieldset className="min-w-0 space-y-1.5 border-t border-line pt-2">
        <legend className="pr-2 text-xs font-semibold">{t("data.items")}</legend>
        {items.map((it, i) => (
          <div key={it.id} className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-1.5">
            <input className={field} aria-label={t("data.itemName", { n: i + 1 })} maxLength={60} value={it.name}
              onChange={(e) => { const v = e.currentTarget.value; setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, name: v } : x))); }} />
            <input className={field} aria-label={t("data.itemAmount", { n: i + 1 })} type="number" inputMode="decimal" step="0.01" value={it.amount}
              onChange={(e) => { const v = e.currentTarget.value; setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, amount: v } : x))); }} />
            <button type="button" className={iconBtn} aria-label={t("data.itemRemove", { n: i + 1 })} onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>✕</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={pill} onClick={() => setItems((xs) => [...xs, { id: nextId.current++, name: "", amount: "" }])}>{t("data.addItem")}</button>
          {items.length > 0 && <span className="num text-[11px] text-ink-3">{t("data.itemSum", { sum: Math.round(itemSum * 100) / 100 })}</span>}
        </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={pill} onClick={onCancel}>{t("data.cancel")}</button>
        <button type="submit" className={primary} disabled={!valid}>{t("data.save")}</button>
      </div>
    </form>
  );
}

// ---------------- trades ----------------

function TradeList({ account, onDataChange }: { account: Account; onDataChange: (label: Text) => void }) {
  const { t, fmt } = useI18n();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the account version changes with every store write
  const records = useMemo(() => listTrades(account.id), [account.id, account.version]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const shown = [...records].sort((a, b) => (a.value.date < b.value.date ? 1 : a.value.date > b.value.date ? -1 : 0));
  useEffect(() => setEditing(null), [account.id]);

  function save(id: string | "new", trade: InvestmentTrade) {
    onDataChange(msg(id === "new" ? "data.impactAdd" : "data.impactEdit", { merchant: trade.instrument }));
    if (id === "new") addTrade(account.id, trade);
    else updateTrade(account.id, id, trade);
    setEditing(null);
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-2">{t("data.tradesIntro")}</p>
        <button type="button" className={primary} onClick={() => setEditing("new")} disabled={editing === "new"}>{t("data.addTrade")}</button>
      </div>
      {editing === "new" && <TradeEditor onSave={(tr) => save("new", tr)} onCancel={() => setEditing(null)} />}
      {shown.length === 0 ? (
        <p className="text-sm text-ink-2">{t("data.noTrades")}</p>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto pr-1">
          {shown.map((r) => (
            <li key={r.id} className="py-1.5">
              {editing === r.id ? (
                <TradeEditor initial={r.value} onSave={(tr) => save(r.id, tr)} onCancel={() => setEditing(null)} />
              ) : (
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.value.instrument}</span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {r.value.date} · {t(`data.side.${r.value.side}`)} · {t(`data.tradeAccount.${r.value.account}`)}
                      {r.value.units ? <> · {t("data.units", { units: fmt.num(r.value.units) })}</> : null}
                    </span>
                  </span>
                  <span className={`num shrink-0 ${r.value.side === "sell" ? "text-bad" : ""}`}>{fmt.chf(r.value.amount)}</span>
                  <button type="button" className={iconBtn} aria-label={t("data.editAria", { merchant: r.value.instrument, date: r.value.date })} onClick={() => setEditing(r.id)}>✎</button>
                  <button type="button" className={iconBtn} aria-label={t("data.deleteAria", { merchant: r.value.instrument, date: r.value.date })}
                    onClick={() => {
                      onDataChange(msg("data.impactDelete", { merchant: r.value.instrument }));
                      deleteTrade(account.id, r.id);
                    }}>✕</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TradeEditor({ initial, onSave, onCancel }: { initial?: InvestmentTrade; onSave: (t: InvestmentTrade) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [date, setDate] = useState(initial?.date ?? today());
  const [account, setAccount] = useState<InvestmentTrade["account"]>(initial?.account ?? "broker");
  const [instrument, setInstrument] = useState(initial?.instrument ?? "");
  const [kind, setKind] = useState<NonNullable<InvestmentTrade["kind"]>>(initial?.kind ?? "fund");
  const [side, setSide] = useState<InvestmentTrade["side"]>(initial?.side ?? "buy");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [units, setUnits] = useState(initial?.units !== undefined ? String(initial.units) : "");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const value = Number(amount);
  const u = units === "" ? undefined : Number(units);
  const valid = validDate(date) && instrument.trim().length > 0 && amount !== "" && value > 0 && value <= MAX && (u === undefined || (Number.isFinite(u) && u > 0));

  return (
    <form aria-label={initial ? t("data.editTrade") : t("data.addTrade")} className="space-y-2 rounded-lg border border-line bg-surface-2 p-3"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const rounded = Math.round(value * 100) / 100;
        onSave({
          date,
          account,
          instrument: instrument.trim().slice(0, 80),
          kind: account === "3a" ? "fund" : kind,
          side,
          amount: rounded,
          ...(u ? { units: u, price: Math.round((rounded / u) * 100) / 100 } : {}),
        });
      }}>
      <div className="grid grid-cols-2 gap-2 text-xs font-medium text-ink-2">
        <label className="col-span-2 min-w-0">
          {t("data.fieldInstrument")}
          <input ref={first} className={`${field} mt-1`} required maxLength={80} value={instrument} onChange={(e) => setInstrument(e.currentTarget.value)} />
        </label>
        <label className="min-w-0">
          {t("data.fieldDate")}
          <input className={`${field} mt-1`} type="date" required value={date} onChange={(e) => setDate(e.currentTarget.value)} />
        </label>
        <label className="min-w-0">
          {t("data.fieldTradeAmount")}
          <input className={`${field} mt-1`} type="number" inputMode="decimal" step="0.01" min={0.01} max={MAX} required value={amount} onChange={(e) => setAmount(e.currentTarget.value)} />
        </label>
        <label className="min-w-0">
          {t("data.fieldSide")}
          <select className={`${field} mt-1`} value={side} onChange={(e) => setSide(e.currentTarget.value as InvestmentTrade["side"])}>
            <option value="buy">{t("data.side.buy")}</option>
            <option value="sell">{t("data.side.sell")}</option>
          </select>
        </label>
        <label className="min-w-0">
          {t("data.fieldAccount")}
          <select className={`${field} mt-1`} value={account} onChange={(e) => setAccount(e.currentTarget.value as InvestmentTrade["account"])}>
            <option value="broker">{t("data.tradeAccount.broker")}</option>
            <option value="3a">{t("data.tradeAccount.3a")}</option>
          </select>
        </label>
        <label className="min-w-0">
          {t("data.fieldKind")}
          <select className={`${field} mt-1`} value={account === "3a" ? "fund" : kind} disabled={account === "3a"} onChange={(e) => setKind(e.currentTarget.value as "fund" | "stock")}>
            <option value="fund">{t("data.kindFund")}</option>
            <option value="stock">{t("data.kindStock")}</option>
          </select>
        </label>
        <label className="min-w-0">
          {t("data.fieldUnits")}
          <input className={`${field} mt-1`} type="number" inputMode="decimal" step="any" min={0} value={units} onChange={(e) => setUnits(e.currentTarget.value)} />
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={pill} onClick={onCancel}>{t("data.cancel")}</button>
        <button type="submit" className={primary} disabled={!valid}>{t("data.save")}</button>
      </div>
    </form>
  );
}
