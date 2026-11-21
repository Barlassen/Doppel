"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { DOC_KINDS, MAX_AMOUNT, isAmount, type DocKind, type Extraction, type SnapResult } from "@/lib/snap/types";
import { TierChip } from "./Inspector";

export const SAMPLES = [
  { id: "qr", file: "/samples/qr-bill.svg", label: "QR-bill", hint: "Health insurance" },
  { id: "listing", file: "/samples/listing.svg", label: "Listing", hint: "Flat in Zürich" },
  { id: "receipt", file: "/samples/receipt.svg", label: "Receipt", hint: "Supermarket" },
  { id: "payslip", file: "/samples/payslip.svg", label: "Payslip", hint: "Monthly pay" },
  { id: "note", file: "/samples/note.svg", label: "Note", hint: "Handwritten goal" },
];

const ROUTES: Record<SnapResult["route"], string> = {
  qr: "Swiss QR",
  cache: "Repeat image",
  "local-regex": "Local regex",
  "text-llm": "Text model",
  "vision-llm": "Vision model",
  "offline-heuristic": "Local fallback",
};
const KIND_LABELS: Record<DocKind, string> = {
  listing: "Property listing",
  receipt: "Receipt",
  bill: "Bill",
  payslip: "Payslip",
  note: "Planned expense",
  other: "Choose a document type",
};
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export interface SnapItem {
  id: string;
  name: string;
  result: SnapResult;
  summary: string;
}

interface PendingReview {
  name: string;
  result: SnapResult;
}

export function SnapPanel({ onResult, items, forceLlm }: {
  onResult: (name: string, r: SnapResult) => void;
  items: SnapItem[];
  forceLlm?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [review, setReview] = useState<PendingReview | null>(null);
  const active = useRef(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);

  async function handle(src: File | string, name: string) {
    if (active.current || review) return;
    setError(null);
    if (typeof src !== "string") {
      if (src.size > MAX_FILE_BYTES) {
        setError("Choose an image under 15 MB.");
        return;
      }
      if (/\.(heic|heif)$/i.test(src.name) || /image\/(heic|heif)/i.test(src.type)) {
        setError("This browser may not open HEIC photos. Export the photo as JPEG or PNG and upload it again.");
        return;
      }
    }

    active.current = true;
    setBusy(true);
    setProgress("Preparing scanner…");
    try {
      const { runSnap } = await import("@/lib/snap/pipeline");
      const result = await runSnap(src, { forceLlm, onProgress: setProgress });
      setReview({ name, result });
    } catch {
      setError("The image could not be read. Try a clear JPEG or PNG.");
    } finally {
      active.current = false;
      setBusy(false);
      setProgress("");
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
    <section className="card min-w-0 p-4 sm:p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2">
        <div className="label">Snap to twin</div>
        <span className="text-[11px] text-ink-3">runs in your browser first</span>
      </div>
      <p className="mb-3 text-sm text-ink-2">Drop a bill, receipt, payslip, property listing or a handwritten note.</p>

      <button
        type="button"
        ref={uploadButton}
        disabled={disabled}
        aria-label="Upload image"
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
        className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-3 py-5 text-center transition disabled:opacity-60 ${
          drag ? "border-s1 bg-s1/5" : "border-line enabled:hover:border-ink-3"
        }`}
      >
        <span className="text-2xl" aria-hidden="true">📷</span>
        <span className="mt-1 text-sm font-medium">Drop an image or upload</span>
      </button>
      <input ref={uploadInput} type="file" accept="image/*" className="hidden" onChange={pick} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-3">Up to 15 MB</p>
        <button type="button" disabled={disabled}
          onClick={() => { if (!active.current) cameraInput.current?.click(); }}
          className="rounded-full border border-line px-3 py-1.5 text-xs font-medium enabled:hover:border-ink-3 disabled:opacity-50">
          Take photo
        </button>
      </div>
      <div role="status" className="text-sm text-ink-2">
        {progress && <p className="mt-2">{progress}</p>}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {SAMPLES.map((s) => (
          <button type="button" key={s.id} disabled={disabled} title={s.hint}
            onClick={() => void handle(s.file, s.label)}
            className="min-w-0 rounded-lg border border-line p-1.5 text-left transition enabled:hover:border-ink-3 disabled:opacity-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.file} alt="" className="h-12 w-full rounded object-cover object-top" />
            <div className="mt-1 truncate text-[11px] font-medium">{s.label}</div>
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mt-3 text-xs text-bad">{error}</p>}
      {review && (
        <ReviewCard review={review} onDiscard={closeReview} onConfirm={(extraction) => {
          onResult(review.name, { ...review.result, extraction });
          closeReview();
        }} />
      )}

      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.slice(-4).reverse().map((it) => (
            <li key={it.id} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <TierChip tier={it.result.tier} route={it.result.route} />
                <span className="num text-[11px] text-ink-3">
                  {it.result.usageKnown ? `${it.result.usage.promptTokens + it.result.usage.completionTokens} tokens` : "Usage unavailable"} ·{" "}
                  {Math.round(it.result.steps.reduce((s, x) => s + x.ms, 0))} ms
                </span>
              </div>
              <div className="break-words">{it.summary}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const editField = "w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";

function ReviewCard({ review, onConfirm, onDiscard }: {
  review: PendingReview;
  onConfirm: (e: Extraction) => void;
  onDiscard: () => void;
}) {
  const { name, result } = review;
  const [draft, setDraft] = useState(result.extraction);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const party = draft.kind === "receipt" || draft.kind === "bill";
  const listing = draft.kind === "listing";
  const needKind = draft.kind === "other";
  const needAmount = !isAmount(draft.amount) || draft.amount <= 0;

  function update<K extends keyof Extraction>(key: K, value: Extraction[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      aria-label="Review scan"
      data-tier={result.tier}
      data-route={result.route}
      data-outcome={result.outcome}
      className="mt-3 min-w-0 space-y-3 rounded-xl border border-line bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!needKind && !needAmount) onConfirm(draft);
      }}
    >
      <div>
        <h3 ref={heading} tabIndex={-1} className="break-words text-sm font-semibold">Review scan · {name}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TierChip tier={result.tier} route={result.route} />
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">{ROUTES[result.route]}</span>
          {result.ocrConfidence !== undefined && (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
              OCR {Math.round(result.ocrConfidence)}%
            </span>
          )}
        </div>
      </div>

      {(needKind || (needAmount && result.fieldsMissing?.includes("amount")) || draft.amount === 0) && (
        <p className="text-xs text-warn">
          {needKind ? "Choose a document type and enter the amount." :
            draft.amount === 0 ? "Enter a positive CHF amount to continue." :
              "The scan could not find an amount. Enter the CHF amount to continue."}
        </p>
      )}

      <div className="grid gap-2 text-xs font-medium text-ink-2 sm:grid-cols-2">
        <label className="min-w-0">
          Document type
          <select className={editField} value={draft.kind} onChange={(e) => {
            const kind = e.target.value as DocKind;
            setDraft((prev) => ({ ...prev, kind, category: kind === prev.kind ? prev.category : undefined }));
          }}>
            {DOC_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          Amount (CHF)
          <input className={editField} type="number" inputMode="decimal" min={0.01} max={MAX_AMOUNT} step="0.01" required
            value={draft.amount ?? ""} onChange={(e) => update("amount", isAmount(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : undefined)} />
        </label>
        <label className="min-w-0">
          Label
          <input className={editField} maxLength={80} value={draft.label ?? ""} onChange={(e) => update("label", e.target.value || undefined)} />
        </label>
        {party && (
          <label className="min-w-0">
            {draft.kind === "bill" ? "Creditor" : "Merchant"}
            <input className={editField} maxLength={80} value={draft.merchant ?? ""} onChange={(e) => update("merchant", e.target.value || undefined)} />
          </label>
        )}
        {(party || draft.kind === "payslip") && (
          <label className="min-w-0">
            Date
            <input className={editField} type="date" value={draft.date ?? ""} onChange={(e) => update("date", e.target.value || undefined)} />
          </label>
        )}
        {draft.kind === "note" && (
          <label className="min-w-0">
            Year
            <input className={editField} type="number" min={1900} max={2200} step={1} value={draft.year ?? ""}
              onChange={(e) => update("year", e.currentTarget.value ? e.currentTarget.valueAsNumber : undefined)} />
          </label>
        )}
        {listing && (
          <>
            <label className="min-w-0">
              Location
              <input className={editField} maxLength={80} value={draft.location ?? ""} onChange={(e) => update("location", e.target.value || undefined)} />
            </label>
            <label className="min-w-0">
              Rooms
              <input className={editField} type="number" inputMode="decimal" min={0.5} max={100} step={0.5} value={draft.rooms ?? ""}
                onChange={(e) => update("rooms", e.currentTarget.value ? e.currentTarget.valueAsNumber : undefined)} />
            </label>
          </>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onDiscard} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-ink-3">Discard</button>
        <button type="submit" disabled={needKind || needAmount} className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-45">Add to twin</button>
      </div>
    </form>
  );
}
