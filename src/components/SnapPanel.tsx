"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { DOC_KINDS, MAX_AMOUNT, isAmount, type DocKind, type Extraction, type SnapResult } from "@/lib/snap/types";
import { TRANSACTION_CATEGORIES, type ReceiptItem } from "@/lib/finance/types";
import { categoryMsg } from "@/lib/data/merchants";
import { receiptMoney } from "@/lib/format";
import { isReceiptItemAmount, MAX_RECEIPT_ITEMS, RECEIPT_ITEM_NAME_LIMIT, receiptItemCategory, receiptSum } from "@/lib/snap/receipt";
import { TierChip } from "./Inspector";
import { VisionReviewCard } from "./VisionReview";
import { ReceiptDetails } from "./ReceiptDetails";
import { CardHeader } from "./ui";

import { msg, type Msg, type Text } from "@/lib/i18n/types";
import { useI18n } from "@/lib/i18n/I18nProvider";

const SAMPLES = [
  { id: "receipt", file: "/samples/receipt.svg" },
  { id: "qr", file: "/samples/qr-bill.svg" },
  { id: "listing", file: "/samples/listing.svg" },
  { id: "payslip", file: "/samples/payslip.svg" },
  { id: "note", file: "/samples/note.svg" },
  { id: "plan", file: "/samples/vision/plan-cad-areas.svg" },
] as const;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export interface SnapItem {
  id: string;
  name: Text;
  result: SnapResult;
  summary: Msg;
  odds?: Msg;
}

interface PendingReview {
  name: Text;
  result: SnapResult;
}

export function SnapPanel({ onResult, items, forceLlm }: {
  onResult: (name: Text, r: SnapResult) => void;
  items: SnapItem[];
  forceLlm?: boolean;
}) {
  const { t, tm } = useI18n();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Msg>();
  const [error, setError] = useState<Msg | null>(null);
  const [drag, setDrag] = useState(false);
  const [review, setReview] = useState<PendingReview | null>(null);
  const active = useRef(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);

  async function handle(src: File | string, name: Text) {
    if (active.current || review) return;
    setError(null);
    if (typeof src !== "string") {
      if (src.size > MAX_FILE_BYTES) {
        setError(msg("snap.tooBig"));
        return;
      }
      if (/\.(heic|heif)$/i.test(src.name) || /image\/(heic|heif)/i.test(src.type)) {
        setError(msg("snap.heic"));
        return;
      }
    }

    active.current = true;
    setBusy(true);
    setProgress(msg("progress.preparing"));
    try {
      const { runSnap } = await import("@/lib/snap/pipeline");
      const result = await runSnap(src, { forceLlm, onProgress: setProgress });
      setReview({ name, result });
    } catch {
      setError(msg("snap.unreadable"));
    } finally {
      active.current = false;
      setBusy(false);
      setProgress(undefined);
    }
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handle(file, file.name);
  }

  function closeReview() {
    setReview(null);
    requestAnimationFrame(() => uploadButton.current?.focus());
  }

  const disabled = busy || !!review;
  return (
    <section className="card min-w-0 p-5 sm:p-6">
      <CardHeader title={t("snap.title")} className="mb-1" />
      <p className="mb-4 text-sm text-ink-2">{t("snap.intro")}</p>

      <button
        type="button"
        ref={uploadButton}
        disabled={disabled}
        aria-label={t("snap.uploadAria")}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const file = e.dataTransfer.files[0];
          if (file) void handle(file, file.name);
        }}
        onClick={() => { if (!active.current) uploadInput.current?.click(); }}
        className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-3 py-4 text-center transition disabled:opacity-60 ${
          drag ? "border-s1 bg-s1/5" : "border-line enabled:hover:border-ink-3"
        }`}
      >
        <span className="text-xl" aria-hidden="true">📷</span>
        <span className="mt-1 text-sm font-medium">{t("snap.drop")}</span>
      </button>
      <input ref={uploadInput} type="file" accept="image/*" className="hidden" onChange={pick} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-2">{t("common.separator", { first: t("snap.maxSize"), second: t("snap.subtitle") })}</p>
        <button type="button" disabled={disabled}
          onClick={() => { if (!active.current) cameraInput.current?.click(); }}
          className="rounded-full border border-line px-3 py-1.5 text-xs font-medium enabled:hover:border-ink-3 disabled:opacity-50">
          {t("snap.takePhoto")}
        </button>
      </div>
      <div role="status" className="text-sm text-ink-2">
        {progress && <p className="mt-2">{tm(progress)}</p>}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {SAMPLES.map((s) => (
          <button type="button" key={s.id} disabled={disabled} title={t(`snap.samples.${s.id}Hint`)} aria-label={t(`snap.samples.${s.id}`)}
            onClick={() => void handle(s.file, msg(`snap.samples.${s.id}`))}
            className="min-w-0 rounded-lg border border-line p-1.5 text-left transition enabled:hover:border-ink-3 disabled:opacity-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.file} alt="" className="h-12 w-full rounded object-cover object-top" />
            <div className="mt-1 truncate text-[11px] font-medium">{t(`snap.samples.${s.id}`)}</div>
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mt-3 text-xs text-bad">{tm(error)}</p>}
      {review && (
        review.result.extraction.vision ? (
          <VisionReviewCard name={review.name} result={review.result} onDiscard={closeReview} onConfirm={(extraction) => {
            onResult(review.name, { ...review.result, extraction });
            closeReview();
          }} />
        ) : (
          <ReviewCard review={review} onDiscard={closeReview} onConfirm={(extraction) => {
            onResult(review.name, { ...review.result, extraction });
            closeReview();
          }} />
        )
      )}

      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.slice(-4).reverse().map((it) => (
            <li key={it.id} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <TierChip tier={it.result.tier} route={it.result.route} />
                <span className="num text-[11px] text-ink-2">
                  {t("common.separator", {
                    first: it.result.usageKnown ? msg("common.tokens", { count: it.result.usage.promptTokens + it.result.usage.completionTokens }) : msg("snap.usageUnavailable"),
                    second: msg("common.ms", { value: Math.round(it.result.steps.reduce((sum, step) => sum + step.ms, 0)) }),
                  })}
                </span>
              </div>
              <div className="break-words">{tm(it.summary)}{tm(it.odds)}</div>
              {it.result.extraction.kind === "receipt" && !!it.result.extraction.items?.length && (
                <ReceiptDetails items={it.result.extraction.items} total={it.result.extraction.amount} currency={it.result.extraction.currency} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const editField = "w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";

interface ReviewItem extends Omit<ReceiptItem, "amount"> {
  id: number;
  amount?: number;
}

function ReviewCard({ review, onConfirm, onDiscard }: {
  review: PendingReview;
  onConfirm: (e: Extraction) => void;
  onDiscard: () => void;
}) {
  const { t, tm, rich } = useI18n();
  const { name, result } = review;
  const [draft, setDraft] = useState(result.extraction);
  const [rows, setRows] = useState<ReviewItem[]>(() => (result.extraction.items ?? []).map((item, id) => ({ ...item, id })));
  const nextRowId = useRef(rows.length);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const receipt = draft.kind === "receipt";
  const party = receipt || draft.kind === "bill";
  const listing = draft.kind === "listing";
  const needKind = draft.kind === "other";
  const needAmount = !isAmount(draft.amount) || draft.amount <= 0;
  const currency = draft.currency ?? "CHF";
  const needsChf = receipt && currency !== "CHF";
  const items = rows.flatMap(({ name: input, amount, qty, unitPrice, category }) => {
    const name = input.trim();
    if (!name || !isReceiptItemAmount(amount)) return [];
    return [{ name, amount, qty, unitPrice, category: category ?? receiptItemCategory(name, draft.category) }];
  });
  const sum = receiptSum(items, draft.amount);
  const incompleteItems = receipt && items.length !== rows.length;

  function update<K extends keyof Extraction>(key: K, value: Extraction[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function editRow(id: number, fields: Partial<ReviewItem>) {
    setRows((current) => current.map((item) => item.id === id ? { ...item, ...fields } : item));
  }

  return (
    <form
      aria-label={t("review.formAria")}
      data-tier={result.tier}
      data-route={result.route}
      data-outcome={result.outcome}
      className="mt-3 min-w-0 scroll-mt-24 space-y-3 rounded-xl border border-line bg-surface-2 p-3 sm:scroll-mt-16"
      onSubmit={(e) => {
        e.preventDefault();
        if (!needKind && !needAmount && !incompleteItems && !needsChf) {
          onConfirm({ ...draft, items: receipt ? items : undefined, currency: receipt ? currency : undefined });
        }
      }}
    >
      <div>
        <h3 ref={heading} tabIndex={-1} className="break-words text-sm font-semibold">{t("review.heading", { name })}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {receipt && result.tier === 2 && result.steps.some((step) => typeof step.name === "object" && step.name.key === "step.textLlm")
            ? <span className="rounded-full bg-s2/15 px-2 py-0.5 text-[11px] font-semibold text-s2">{t("receipt.textTier")}</span>
            : <TierChip tier={result.tier} />}
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">{t(`snapRoute.${result.route}`)}</span>
          {result.ocrConfidence !== undefined && (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
              {t("review.ocr", { p: result.ocrConfidence / 100 })}
            </span>
          )}
        </div>
      </div>

      {(needKind || (needAmount && result.fieldsMissing?.includes("amount")) || draft.amount === 0) && (
        <p className="text-xs text-warn">
          {t(needKind ? "review.needKind" : draft.amount === 0 ? "review.needPositive" : "review.noAmount")}
        </p>
      )}

      <div className={`grid gap-2 text-xs font-medium text-ink-2 ${receipt ? "grid-cols-2" : "sm:grid-cols-2"}`}>
        <label className="min-w-0">
          {t("review.docType")}
          <select className={editField} value={draft.kind} onChange={(e) => {
            const kind = e.target.value as DocKind;
            setDraft((prev) => ({ ...prev, kind, category: kind === prev.kind ? prev.category : undefined }));
          }}>
            {DOC_KINDS.map((kind) => <option key={kind} value={kind}>{t(`kind.${kind}`)}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          {receipt ? t("receipt.total", { currency }) : t("review.amount")}
          <input className={editField} type="number" inputMode="decimal" min={0.01} max={MAX_AMOUNT} step="0.01" required
            value={draft.amount ?? ""} onChange={(e) => update("amount", isAmount(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : undefined)} />
        </label>
        {receipt && (
          <label className="min-w-0">
            {t("receipt.category")}
            <select className={editField} value={draft.category && TRANSACTION_CATEGORIES.some((category) => category === draft.category) ? draft.category : "shopping"}
              onChange={(e) => update("category", e.currentTarget.value)}>
              {TRANSACTION_CATEGORIES.map((category) => <option key={category} value={category}>{tm(categoryMsg(category))}</option>)}
            </select>
          </label>
        )}
        <label className="min-w-0">
          {t("review.label")}
          <input className={editField} maxLength={80} value={tm(draft.labelMsg ?? draft.label)} onChange={(e) => {
            const label = e.currentTarget.value || undefined;
            setDraft((prev) => ({ ...prev, label, labelMsg: undefined }));
          }} />
        </label>
        {party && (
          <label className={receipt ? "col-span-2 min-w-0" : "min-w-0"}>
            {t(draft.kind === "bill" ? "review.creditor" : "review.merchant")}
            <input className={editField} maxLength={80} value={draft.merchant ?? ""} onChange={(e) => update("merchant", e.target.value || undefined)} />
          </label>
        )}
        {(party || draft.kind === "payslip") && (
          <label className={receipt ? "col-span-2 min-w-0" : "min-w-0"}>
            {t("review.date")}
            <input className={editField} type="date" value={draft.date ?? ""} onChange={(e) => update("date", e.target.value || undefined)} />
          </label>
        )}
        {draft.kind === "note" && (
          <label className="min-w-0">
            {t("review.year")}
            <input className={editField} type="number" min={1900} max={2200} step={1} value={draft.year ?? ""}
              onChange={(e) => update("year", e.currentTarget.value ? e.currentTarget.valueAsNumber : undefined)} />
          </label>
        )}
        {listing && (
          <>
            <label className="min-w-0">
              {t("review.location")}
              <input className={editField} maxLength={80} value={draft.location ?? ""} onChange={(e) => update("location", e.target.value || undefined)} />
            </label>
            <label className="min-w-0">
              {t("review.rooms")}
              <input className={editField} type="number" inputMode="decimal" min={0.5} max={100} step={0.5} value={draft.rooms ?? ""}
                onChange={(e) => update("rooms", e.currentTarget.value ? e.currentTarget.valueAsNumber : undefined)} />
            </label>
          </>
        )}
      </div>

      {receipt && (
        <fieldset className="min-w-0 space-y-2 border-t border-line pt-2">
          <legend className="pr-2 text-xs font-semibold">{t("receipt.items")}</legend>
          {rows.length > 0 && (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {rows.map((item, index) => (
                <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_4.25rem_auto] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_auto]">
                  <input className={editField} aria-label={t("receipt.itemName", { count: index + 1 })} maxLength={RECEIPT_ITEM_NAME_LIMIT}
                    required value={item.name} onChange={(e) => editRow(item.id, { name: e.currentTarget.value, category: undefined })} />
                  <input className={editField} aria-label={t("receipt.itemAmount", { count: index + 1, currency })} type="number"
                    inputMode="decimal" min={-MAX_AMOUNT} max={MAX_AMOUNT} step="0.01" required value={item.amount ?? ""}
                    onChange={(e) => editRow(item.id, { amount: Number.isFinite(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : undefined })} />
                  <button type="button" aria-label={t("receipt.remove", { count: index + 1 })}
                    onClick={() => setRows((current) => current.filter((row) => row.id !== item.id))}
                    className="size-8 rounded-md border border-line text-base text-ink-2 hover:border-ink-3">×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" disabled={rows.length >= MAX_RECEIPT_ITEMS} onClick={() => {
              const id = nextRowId.current++;
              setRows((current) => [...current, { id, name: "" }]);
            }} className="rounded-full border border-line px-2.5 py-1 text-xs font-medium enabled:hover:border-ink-3 disabled:opacity-45">
              {t("receipt.addItem")}
            </button>
            <span className="num text-xs text-ink-2">
              {rich("receipt.sum", {
                sum: <span className="whitespace-nowrap">{receiptMoney(sum.amount, currency)}</span>,
                total: <span className="whitespace-nowrap">{draft.amount === undefined ? "—" : receiptMoney(draft.amount, currency)}</span>,
              })}
            </span>
          </div>
          {!incompleteItems && draft.amount !== undefined && !sum.matches && (
            <p role="status" className="text-xs text-warn">{t(items.length ? "receipt.mismatch" : "receipt.noItems")}</p>
          )}
          {needsChf && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-warn">
              <span>{t("receipt.convert")}</span>
              <button type="button" className="rounded-full border border-line px-2.5 py-1 text-ink-2 hover:border-ink-3" onClick={() => {
                setDraft((current) => ({ ...current, currency: "CHF", amount: undefined }));
                setRows((current) => current.map((item) => ({ ...item, amount: undefined, unitPrice: undefined })));
              }}>{t("receipt.enterChf")}</button>
            </div>
          )}
        </fieldset>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onDiscard} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-ink-3">{t("review.discard")}</button>
        <button type="submit" disabled={needKind || needAmount || incompleteItems || needsChf} className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-45">{t("review.add")}</button>
      </div>
    </form>
  );
}
