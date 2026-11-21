"use client";

import { useEffect, useRef, useState } from "react";
import { runSnap } from "@/lib/snap/pipeline";
import { getOcrWorker } from "@/lib/snap/ocr";
import type { SnapResult } from "@/lib/snap/types";
import { TierChip } from "./Inspector";

export const SAMPLES = [
  { id: "qr", file: "/samples/qr-bill.svg", label: "QR-bill", hint: "Health insurance" },
  { id: "listing", file: "/samples/listing.svg", label: "Listing", hint: "Flat in Zürich" },
  { id: "receipt", file: "/samples/receipt.svg", label: "Receipt", hint: "Supermarket" },
  { id: "note", file: "/samples/note.svg", label: "Note", hint: "Handwritten goal" },
];

export interface SnapItem {
  id: string;
  name: string;
  result: SnapResult;
  summary: string;
}

export function SnapPanel({ onResult, items }: { onResult: (name: string, r: SnapResult) => void; items: SnapItem[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Warm the OCR worker in the background so the first snap is fast on stage.
  useEffect(() => {
    const t = setTimeout(() => void getOcrWorker(), 1500);
    return () => clearTimeout(t);
  }, []);

  async function handle(src: Blob | string, name: string) {
    setBusy(name);
    setError(null);
    try {
      onResult(name, await runSnap(src));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-center justify-between">
        <div className="label">Snap to twin</div>
        <span className="text-[11px] text-ink-3">runs in your browser first</span>
      </div>
      <p className="mb-3 text-sm text-ink-2">Drop a bill, receipt, payslip, property listing or a handwritten note.</p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handle(f, f.name);
        }}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
          drag ? "border-s1 bg-s1/5" : "border-line hover:border-ink-3"
        }`}
      >
        {busy ? (
          <span className="pulse-soft text-sm text-ink-2">Reading “{busy}” locally…</span>
        ) : (
          <>
            <span className="text-2xl">📷</span>
            <span className="mt-1 text-sm font-medium">Drop an image or tap to take a photo</span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handle(f, f.name);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            disabled={!!busy}
            onClick={() => void handle(s.file, s.label)}
            className="group rounded-lg border border-line p-1.5 text-left transition hover:border-ink-3 disabled:opacity-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.file} alt="" className="h-14 w-full rounded object-cover object-top" />
            <div className="mt-1 truncate text-[11px] font-medium">{s.label}</div>
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-bad">{error}</p>}

      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {[...items].reverse().slice(0, 4).map((it) => (
            <li key={it.id} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <div className="mb-1 flex items-center gap-2">
                <TierChip tier={it.result.tier} />
                <span className="num text-[11px] text-ink-3">
                  {it.result.usage.promptTokens + it.result.usage.completionTokens} tokens ·{" "}
                  {Math.round(it.result.steps.reduce((s, x) => s + x.ms, 0))} ms
                </span>
              </div>
              <div>{it.summary}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
