"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LedgerEntry, LedgerRoute, NaiveComparison } from "@/lib/frugal/ledger";
import { exclusionReason, resolveOutcome, resolveRoute, resolveUsageKnown, totals } from "@/lib/frugal/ledger";
import { ENERGY_ASSUMPTIONS, NAIVE_PRICE } from "@/lib/frugal/tokens";
import { callTwin } from "@/lib/llm";
import type { Extraction } from "@/lib/snap/types";
import { chf, usd } from "@/lib/format";
import { groupCh } from "@/lib/format";

const TIER_STYLE: Record<string, { label: string; cls: string }> = {
  "0": { label: "Tier 0 · QR", cls: "bg-good/15 text-good" },
  "1": { label: "Tier 1 · OCR → text", cls: "bg-warn/15 text-warn" },
  "2": { label: "Tier 2 · 512px VLM", cls: "bg-s1/15 text-s1" },
  "local-parser": { label: "Local parser", cls: "bg-good/15 text-good" },
  llm: { label: "Small LLM", cls: "bg-warn/15 text-warn" },
};

const ROUTE_STYLE: Record<LedgerRoute, { label: string; cls: string }> = {
  qr: { label: "QR · local", cls: "bg-good/15 text-good" },
  cache: { label: "Cache · local", cls: "bg-good/15 text-good" },
  "local-regex": { label: "Local regex", cls: "bg-good/15 text-good" },
  "local-parser": { label: "Local parser", cls: "bg-good/15 text-good" },
  "text-llm": { label: "Text LLM", cls: "bg-warn/15 text-warn" },
  "vision-llm": { label: "Vision LLM", cls: "bg-s1/15 text-s1" },
  "offline-heuristic": { label: "Offline regex", cls: "bg-surface-2 text-ink-2 border border-line" },
  "offline-template": { label: "Offline template", cls: "bg-surface-2 text-ink-2 border border-line" },
};

export function TierChip({ tier, route }: { tier: LedgerEntry["tier"]; route?: LedgerRoute }) {
  const s = route ? ROUTE_STYLE[route] : TIER_STYLE[String(tier)] ?? TIER_STYLE["llm"];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

export function FrugalBadge({ entries, onClick }: { entries: LedgerEntry[]; onClick: () => void }) {
  const t = totals(entries);
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-frugal"
      title="Open the Frugal Pipeline Inspector"
    >
      <span className="text-frugal" aria-hidden="true">⚡</span>
      <span className="num">{groupCh(t.ours)} tokens</span>
      {t.tokenSavedPct !== null && (
        <span className="num font-semibold text-frugal">−{(t.tokenSavedPct * 100).toFixed(1)}%</span>
      )}
      {entries.length > 0 && t.measuredCount === 0 && (
        <span className="text-[11px] font-medium text-warn">
          {t.offlineCount > 0 ? "offline" : "unmeasured"}
        </span>
      )}
    </button>
  );
}

function formatBytes(bytes: number | undefined): string {
  if (bytes == null) return "—";
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function parseAmount(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * The naive prompt asks GPT-4o for "every financial detail", so it nests amounts freely
 * (e.g. price.amount, totals.net_pay). Walk the whole object: prefer a value equal to ours,
 * otherwise the first number under an amount-like key. Never penalise GPT-4o for its layout.
 */
function findNaiveAmount(data: unknown, ours?: number): number | undefined {
  const found: { key: string; value: number }[] = [];
  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 6 || v == null) return;
    if (typeof v === "number" || typeof v === "string") {
      const cleaned = typeof v === "string" ? v.replace(/CHF|Fr\.?/gi, "").replace(/[’'\s]/g, "").replace(/,(?=\d{3}(?!\d))/g, "") : "";
      const n = typeof v === "number" ? v : /^\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : undefined;
      if (n != null && Number.isFinite(n) && n > 0) found.push({ key, value: n });
      return;
    }
    if (Array.isArray(v)) v.forEach((x) => walk(x, key, depth + 1));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(data, "", 0);
  const sameAsOurs = ours != null ? found.find((f) => amountsMatch(ours, f.value)) : undefined;
  if (sameAsOurs) return sameAsOurs.value;
  const amountLike = /amount|total|price|preis|net|lohn|salary|payable|sum|betrag|target|budget/i;
  return (found.find((f) => amountLike.test(f.key) && !/date|year|zip|postal|iban|rooms?|area|m2|qty|quantity|rate|percent/i.test(f.key)) ?? undefined)?.value;
}

function amountsMatch(a?: number, b?: number): boolean | null {
  if (a == null && b == null) return null;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.005);
}

export interface InspectorProps {
  entries: LedgerEntry[];
  open: boolean;
  onClose: () => void;
  /** Optional external comparison state (falls back to internal state if omitted). */
  comparisons?: Record<string, NaiveComparison>;
  onComparison?: (entryId: string, result: NaiveComparison) => void;
}

export function Inspector({ entries, open, onClose, comparisons: externalComparisons, onComparison }: InspectorProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [localComparisons, setLocalComparisons] = useState<Record<string, NaiveComparison>>({});
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<Record<string, string>>({});

  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const comparisons = externalComparisons ?? localComparisons;
  const t = totals(entries, comparisons);

  // Accessible dialog lifecycle: move focus in, trap Tab, close on Esc, restore focus on close.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the close button so keyboard users immediately land on an actionable control.
    const raf = requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
        return;
      }
      if (ev.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      const prev = prevFocusRef.current;
      if (prev && prev.isConnected) prev.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const measuredEntries = entries.filter((e) => exclusionReason(e) === null);
  const excludedEntries = entries.filter((e) => exclusionReason(e) !== null);
  const maxTokens = Math.max(t.naive, t.ours, 1);

  async function runNaiveCompare(e: LedgerEntry) {
    if (!e.naiveImage || comparingId) return;
    setComparingId(e.id);
    setCompareError((prev) => {
      const next = { ...prev };
      delete next[e.id];
      return next;
    });

    const t0 = performance.now();
    const res = await callTwin<Extraction>({ task: "naive_compare", image: e.naiveImage });
    const elapsed = res.ms ?? performance.now() - t0;

    if (!res.ok) {
      setCompareError((prev) => ({
        ...prev,
        [e.id]: res.offline
          ? "No OPENROUTER_API_KEY configured — live GPT-4o check needs an API key. Showing the tile-formula estimate instead."
          : res.error ?? "Naive comparison failed.",
      }));
      setComparingId(null);
      return;
    }

    const promptTokens = res.usage?.promptTokens ?? 0;
    const completionTokens = res.usage?.completionTokens ?? 0;
    const costUsd =
      res.usage?.costUsd && res.usage.costUsd > 0
        ? res.usage.costUsd
        : (promptTokens * NAIVE_PRICE.input + completionTokens * NAIVE_PRICE.output) / 1e6;
    const naiveAmount = findNaiveAmount(res.data, e.extractedAmount);
    const result: NaiveComparison = {
      model: res.usage?.model ?? NAIVE_PRICE.model,
      promptTokens,
      completionTokens,
      costUsd,
      ms: elapsed,
      extractedAmount: naiveAmount,
      extractedKind: res.data?.kind,
      amountMatches: amountsMatch(e.extractedAmount, naiveAmount),
      rawData: res.data,
    };

    if (onComparison) onComparison(e.id, result);
    else setLocalComparisons((prev) => ({ ...prev, [e.id]: result }));
    setComparingId(null);
  }

  const baselineTag =
    t.measuredCount === 0
      ? `estimated · ${NAIVE_PRICE.label}`
      : t.liveNaiveCount === t.measuredCount
        ? "measured · GPT-4o live"
        : t.liveNaiveCount > 0
          ? `${t.liveNaiveCount} measured · ${t.measuredCount - t.liveNaiveCount} estimated`
          : `estimated · ${NAIVE_PRICE.label}`;

  const per1kOurs = t.snapCount > 0 ? (t.snapOursCost / t.snapCount) * 1000 : null;
  const per1kNaive = t.snapCount > 0 ? (t.snapNaiveCost / t.snapCount) * 1000 : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-3.5 shadow-2xl outline-none sm:p-6"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="label">Frugal pipeline inspector</div>
              <h2 id={titleId} className="font-serif text-2xl leading-tight sm:text-3xl">
                Every token, accounted for.
              </h2>
            </div>
            <button
              ref={closeBtnRef}
              onClick={onClose}
              aria-label="Close Frugal Pipeline Inspector"
              className="rounded-full border border-line px-3 py-1 text-sm text-ink-2 transition hover:border-ink-3 hover:text-ink"
            >
              Close
            </button>
          </div>

          {/* Measured totals */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-surface-2 p-3.5 sm:p-4">
              <div className="label">Doppel · measured</div>
              <div className="num mt-1 text-xl font-semibold sm:text-2xl">
                {groupCh(t.ours)} tokens
              </div>
              <div className="num text-xs text-ink-2 sm:text-sm">
                {usd(t.oursCost)} · {t.measuredCount} {t.measuredCount === 1 ? "call" : "calls"}
              </div>
            </div>
            <div className="rounded-xl bg-surface-2 p-3.5 sm:p-4">
              <div className="label">Naive baseline · {baselineTag}</div>
              <div className="num mt-1 text-xl font-semibold sm:text-2xl">
                {groupCh(t.naive)} tokens
              </div>
              <div className="num text-xs text-ink-2 sm:text-sm">
                {usd(t.naiveCost)} · {NAIVE_PRICE.formula}
              </div>
            </div>
            <div className="rounded-xl bg-surface-2 p-3.5 sm:p-4">
              <div className="label">Measured savings</div>
              <div className="num mt-1 text-xl font-semibold text-frugal sm:text-2xl">
                {t.tokenSavedPct !== null ? `−${(t.tokenSavedPct * 100).toFixed(1)}% tok` : "—"}
              </div>
              <div className="num text-xs text-ink-2 sm:text-sm">
                {t.costSavedPct !== null
                  ? `Cost −${(t.costSavedPct * 100).toFixed(1)}% · maths runs in TypeScript`
                  : t.excludedCount > 0
                    ? "Offline / failed calls excluded below"
                    : "Run a snap or what-if to measure"}
              </div>
            </div>
          </div>

          {t.measuredCount > 0 && (
            <div className="mb-5 space-y-2">
              <Bar label="Naive" value={t.naive} max={maxTokens} color="var(--ink-3)" />
              <Bar label="Doppel" value={t.ours} max={maxTokens} color="var(--frugal)" />
            </div>
          )}

          {/* Cascade overview */}
          <div className="mb-5 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3 sm:text-sm">
            <Explain chip="0" route="qr" title="Tier 0 · Swiss QR-bill" text="jsQR decodes the SIX payment payload in the browser. Zero bytes leave the device." />
            <Explain chip="1" route="text-llm" title="Tier 1 · Local OCR → text" text="Grayscale + contrast + Tesseract. Clean docs resolve via local regex (0 tok); ambiguous text goes to a small LLM." />
            <Explain chip="2" route="vision-llm" title="Tier 2 · 512px gray JPEG" text="Only when OCR confidence < 65%: a ~20 KB grayscale image goes to a small VLM." />
          </div>

          {/* Measured calls */}
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="label">Measured calls ({measuredEntries.length})</div>
            <span className="text-[11px] text-ink-3">
              Baseline uses actual image dimensions (no upscaling); command/narration baseline caps state at 2.4k chars.
            </span>
          </div>
          {measuredEntries.length === 0 && (
            <p className="mb-4 text-sm text-ink-3">
              {entries.length === 0
                ? "Snap a document or ask a what-if — each call appears here with its route, bytes sent, and payload."
                : "No measured calls yet. Offline, failed, or usage-unknown calls are listed separately below and excluded from savings."}
            </p>
          )}
          {measuredEntries.length > 0 && (
            <ul className="mb-5 space-y-2">
              {[...measuredEntries].reverse().map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  isOpen={expanded === e.id}
                  onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                  comparison={comparisons[e.id]}
                  comparing={comparingId === e.id}
                  compareError={compareError[e.id]}
                  onCompare={() => void runNaiveCompare(e)}
                />
              ))}
            </ul>
          )}

          {/* Excluded calls (offline / failed / usage-unknown) */}
          {excludedEntries.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <div className="label text-warn">Excluded from savings ({excludedEntries.length})</div>
                <span className="text-[11px] text-ink-3">
                  Offline fallbacks, failed extractions, and missing-usage responses are never counted as 100% saved.
                </span>
              </div>
              <ul className="space-y-2">
                {[...excludedEntries].reverse().map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    excluded={exclusionReason(e)}
                    isOpen={expanded === e.id}
                    onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                    comparison={comparisons[e.id]}
                    comparing={comparingId === e.id}
                    compareError={compareError[e.id]}
                    onCompare={() => void runNaiveCompare(e)}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* Unit economics footer */}
          <div className="rounded-xl border border-line bg-surface-2/60 p-3.5 text-xs">
            <div className="label mb-2">Unit economics & rough energy estimate</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="font-medium text-ink">Cost per 1,000 snaps</div>
                {per1kOurs !== null && per1kNaive !== null ? (
                  <div className="num mt-0.5 text-ink-2">
                    Doppel <b className="text-frugal">{usd(per1kOurs)}</b> vs naive GPT-4o{" "}
                    <b className="text-ink">{usd(per1kNaive)}</b>{" "}
                    <span className="text-ink-3">
                      (extrapolated from {t.snapCount} measured {t.snapCount === 1 ? "snap" : "snaps"} this session)
                    </span>
                  </div>
                ) : (
                  <div className="mt-0.5 text-ink-2">
                    Snap a document to compute live session unit cost (benchmark suite in <code className="font-mono">docs/BENCHMARK.md</code>).
                  </div>
                )}
              </div>
              <div>
                <div className="font-medium text-ink">Estimated energy this session (rough estimate)</div>
                {t.measuredCount > 0 ? (
                  <div className="num mt-0.5 text-ink-2">
                    Doppel <b className="text-frugal">{t.oursWh.toFixed(3)} Wh</b> vs naive GPT-4o{" "}
                    <b className="text-ink">{t.naiveWh.toFixed(3)} Wh</b>
                  </div>
                ) : (
                  <div className="mt-0.5 text-ink-2">—</div>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{ENERGY_ASSUMPTIONS.note}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EntryRow({
  entry: e,
  excluded,
  isOpen,
  onToggle,
  comparison,
  comparing,
  compareError,
  onCompare,
}: {
  entry: LedgerEntry;
  excluded?: "offline" | "failed" | "usage-unknown" | null;
  isOpen: boolean;
  onToggle: () => void;
  comparison?: NaiveComparison;
  comparing: boolean;
  compareError?: string;
  onCompare: () => void;
}) {
  const panelId = `ledger-panel-${e.id}`;
  const route = resolveRoute(e);
  const outcome = resolveOutcome(e);
  const usageKnown = resolveUsageKnown(e);
  const oursTok = e.usage.promptTokens + e.usage.completionTokens;
  const naiveTok = comparison
    ? comparison.promptTokens + comparison.completionTokens
    : e.naive.promptTokens + e.naive.completionTokens;
  const naiveCost = comparison ? comparison.costUsd : e.naive.costUsd;

  return (
    <li className={`rounded-xl border ${excluded ? "border-line/80 bg-surface-2/40" : "border-line"}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2.5 text-left"
      >
        <TierChip tier={e.tier} route={route} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.title}</span>
        <OutcomeTag outcome={outcome} excluded={excluded} />
        {comparison && (
          <span className="rounded-full bg-s1/15 px-2 py-0.5 text-[10px] font-semibold text-s1">
            GPT-4o measured
          </span>
        )}
        <span className="num text-xs text-ink-2">{Math.round(e.ms)} ms</span>
        <span className="num text-xs font-semibold">
          {!usageKnown && e.usage.mode === "llm" ? "usage unknown" : `${groupCh(oursTok)} tok`}
        </span>
        {!excluded && (
          <span className="num text-xs text-ink-3 line-through" title={comparison ? "Measured GPT-4o" : "Estimated GPT-4o"}>
            {groupCh(naiveTok)}
          </span>
        )}
      </button>

      {isOpen && (
        <div id={panelId} className="space-y-3 border-t border-line px-3 py-3 text-xs">
          {e.steps && e.steps.length > 0 && (
            <ol className="space-y-1">
              {e.steps.map((s, i) => (
                <li key={i} className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="num w-14 shrink-0 text-right text-ink-3">{s.ms.toFixed(0)} ms</span>
                  <span className="font-medium">{s.name}</span>
                  {s.detail && <span className="text-ink-2 break-words">{s.detail}</span>}
                </li>
              ))}
            </ol>
          )}

          {/* Metadata grid */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-surface-2/70 p-2.5">
              <div className="text-[11px] font-semibold text-ink-3">
                Doppel ({e.usage.mode === "offline" ? "offline fallback" : usageKnown ? "measured" : "usage unknown"})
              </div>
              <div className="mt-1 break-words text-ink">
                {e.usage.model} ·{" "}
                {!usageKnown && e.usage.mode === "llm" ? (
                  <span className="text-warn">usage unknown</span>
                ) : (
                  <span className="num">
                    in {e.usage.promptTokens} / out {e.usage.completionTokens} · {usd(e.usage.costUsd)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-ink-2">
                Route: <code className="font-mono">{route}</code> · Left device:{" "}
                <span className="num font-medium">{formatBytes(e.bytesSent)}</span>
                {e.imageSize && ` · Input ${e.imageSize.width}×${e.imageSize.height}`}
              </div>
              {e.fieldsMissing && e.fieldsMissing.length > 0 && (
                <div className="mt-0.5 text-warn">Missing fields: {e.fieldsMissing.join(", ")}</div>
              )}
            </div>

            <div className="rounded-lg bg-surface-2/70 p-2.5">
              <div className="text-[11px] font-semibold text-ink-3">
                Naive baseline ({comparison ? "measured live" : "estimated"})
              </div>
              <div className="mt-1 break-words text-ink">
                {comparison ? (
                  <span className="num">
                    {comparison.model} · in {comparison.promptTokens} / out {comparison.completionTokens} ·{" "}
                    {usd(comparison.costUsd)} · {Math.round(comparison.ms)} ms
                  </span>
                ) : (
                  <span>
                    {e.naive.description} · <span className="num font-medium">{usd(naiveCost)}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Live GPT-4o comparison CTA + result table */}
          {e.kind === "snap" && e.naiveImage && (
            <div className="rounded-lg border border-line p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-ink">Live baseline check</span>
                  <span className="ml-1.5 text-ink-2">
                    Send the original image straight to GPT-4o and compare real tokens, cost, and accuracy.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={comparing}
                  onClick={onCompare}
                  className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition hover:border-s1 hover:text-s1 disabled:opacity-50"
                >
                  {comparing ? "Running GPT-4o…" : comparison ? "Re-run naive GPT-4o" : "Run the naive way (GPT-4o)"}
                </button>
              </div>

              {compareError && <p className="mt-2 text-xs text-warn">{compareError}</p>}

              {comparison && (
                <div className="mt-2.5 overflow-x-auto">
                  <table className="w-full min-w-[260px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-[11px] text-ink-3">
                        <th className="py-1 pr-2 font-medium">Metric</th>
                        <th className="py-1 pr-2 font-medium">Doppel</th>
                        <th className="py-1 pr-2 font-medium">Naive GPT-4o</th>
                        <th className="py-1 font-medium">Comparison</th>
                      </tr>
                    </thead>
                    <tbody className="num divide-y divide-line/60">
                      <tr>
                        <td className="py-1 pr-2 font-sans text-ink-2">Tokens</td>
                        <td className="py-1 pr-2 font-medium">
                          {!usageKnown && e.usage.mode === "llm" ? "unknown" : groupCh(oursTok)}
                        </td>
                        <td className="py-1 pr-2">{groupCh(naiveTok)}</td>
                        <td className="py-1 font-semibold text-frugal">
                          {naiveTok > 0 && usageKnown
                            ? `−${((1 - oursTok / naiveTok) * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2 font-sans text-ink-2">Cost</td>
                        <td className="py-1 pr-2 font-medium">{usd(e.usage.costUsd)}</td>
                        <td className="py-1 pr-2">{usd(comparison.costUsd)}</td>
                        <td className="py-1 font-semibold text-frugal">
                          {comparison.costUsd > 0 && usageKnown
                            ? `−${((1 - e.usage.costUsd / comparison.costUsd) * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2 font-sans text-ink-2">Latency</td>
                        <td className="py-1 pr-2">{Math.round(e.ms)} ms</td>
                        <td className="py-1 pr-2">{Math.round(comparison.ms)} ms</td>
                        <td className="py-1 text-ink-2">
                          {e.ms <= comparison.ms
                            ? `${(comparison.ms / Math.max(1, e.ms)).toFixed(1)}× faster`
                            : `${Math.round(e.ms - comparison.ms)} ms slower`}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2 font-sans text-ink-2">Amount</td>
                        <td className="py-1 pr-2">
                          {e.extractedAmount != null ? chf(e.extractedAmount) : "—"}
                        </td>
                        <td className="py-1 pr-2">
                          {comparison.extractedAmount != null ? chf(comparison.extractedAmount) : "—"}
                        </td>
                        <td className="py-1 font-sans">
                          {comparison.amountMatches === true && (
                            <span className="font-semibold text-good">Same amount</span>
                          )}
                          {comparison.amountMatches === false && (
                            <span className="font-semibold text-bad">Differs</span>
                          )}
                          {comparison.amountMatches === null && <span className="text-ink-3">n/a</span>}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {e.preview && (
            <div>
              <div className="mb-1 text-ink-3">Compressed image sent to Tier 2 VLM:</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.preview} alt="Compressed grayscale image sent to vision model" className="h-32 rounded border border-line" />
            </div>
          )}

          <div>
            <div className="text-ink-3">
              {e.usage.mode === "llm" ? "Payload that left the browser:" : "Local execution record (nothing sent to cloud):"}
            </div>
            <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all sm:break-normal">
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </li>
  );
}

function OutcomeTag({
  outcome,
  excluded,
}: {
  outcome: "ok" | "partial" | "failed";
  excluded?: "offline" | "failed" | "usage-unknown" | null;
}) {
  if (excluded === "offline") {
    return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-semibold text-warn">offline</span>;
  }
  if (excluded === "usage-unknown") {
    return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-semibold text-warn">usage unknown</span>;
  }
  if (outcome === "failed") {
    return <span className="rounded-full bg-bad/15 px-2 py-0.5 text-[10px] font-semibold text-bad">failed</span>;
  }
  if (outcome === "partial") {
    return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-semibold text-warn">partial</span>;
  }
  return <span className="text-[11px] text-good">ok</span>;
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs sm:gap-3">
      <span className="w-12 shrink-0 text-ink-2 sm:w-14">{label}</span>
      <div className="h-3 flex-1 rounded-full bg-surface-2">
        <div className="h-3 rounded-full" style={{ width: `${Math.max(0.8, (value / max) * 100)}%`, background: color }} />
      </div>
      <span className="num w-16 shrink-0 text-right font-medium sm:w-20">{groupCh(value)}</span>
    </div>
  );
}

function Explain({ chip, route, title, text }: { chip: "0" | "1" | "2"; route: LedgerRoute; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <TierChip tier={Number(chip) as 0 | 1 | 2} route={route} />
      <div className="mt-2 font-medium">{title}</div>
      <div className="text-ink-2">{text}</div>
    </div>
  );
}
