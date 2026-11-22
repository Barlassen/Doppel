"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LedgerEntry, LedgerRoute, NaiveComparison } from "@/lib/frugal/ledger";
import { exclusionReason, resolveOutcome, resolveRoute, resolveUsageKnown, totals } from "@/lib/frugal/ledger";
import { NAIVE_PRICE } from "@/lib/frugal/tokens";
import { callTwin } from "@/lib/llm";
import type { Extraction } from "@/lib/snap/types";
import { ReceiptDetails } from "./ReceiptDetails";
import { Disclosure } from "./ui";
import { msg, type Fmt, type Text } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/I18nProvider";

const TIER_STYLE = {
  0: "bg-good/15 text-good",
  1: "bg-warn/15 text-warn",
  2: "bg-s1/15 text-s1",
  "local-parser": "bg-good/15 text-good",
  llm: "bg-warn/15 text-warn",
} satisfies Record<LedgerEntry["tier"], string>;

const ROUTE_STYLE: Record<LedgerRoute, string> = {
  qr: "bg-good/15 text-good",
  cache: "bg-good/15 text-good",
  "local-regex": "bg-good/15 text-good",
  "local-parser": "bg-good/15 text-good",
  "text-llm": "bg-warn/15 text-warn",
  "vision-llm": "bg-s1/15 text-s1",
  "vision-plan": "bg-s1/15 text-s1",
  "vision-chart": "bg-s1/15 text-s1",
  "offline-heuristic": "bg-surface-2 text-ink-2 border border-line",
  "offline-template": "bg-surface-2 text-ink-2 border border-line",
};

export function TierChip({ tier, route }: { tier: LedgerEntry["tier"]; route?: LedgerRoute }) {
  const { t } = useI18n();
  const style = route ? ROUTE_STYLE[route] : TIER_STYLE[tier];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${style}`}>
    {t(route ? `route.${route}` : `tier.${tier}`)}
  </span>;
}

export function FrugalBadge({ entries, onClick }: { entries: LedgerEntry[]; onClick: () => void }) {
  const { t, fmt } = useI18n();
  const stats = totals(entries);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-7 items-center gap-x-1.5 rounded-full border border-line bg-surface px-2 py-1.5 text-xs font-medium whitespace-nowrap transition hover:border-frugal sm:gap-x-2 sm:px-3"
      title={t("badge.title")}
    >
      <span className="text-frugal" aria-hidden="true">⚡</span>
      <span className="num">{t("common.tokens", { count: stats.ours })}</span>
      {/* The badge only knows the estimated baseline (live GPT-4o checks happen inside the Inspector): hence "≈". */}
      {stats.tokenSavedPct !== null && (
        <span className="num hidden font-semibold text-frugal sm:inline" title={t("ux.insp.savingEstimated")}>
          {t("ux.insp.approx", { value: savedPercent(fmt, stats.tokenSavedPct, 0) })}
        </span>
      )}
      {entries.length > 0 && stats.measuredCount === 0 && (
        <span className="text-[11px] font-medium text-warn">
          {t(stats.offlineCount > 0 ? "badge.offline" : "badge.unmeasured")}
        </span>
      )}
    </button>
  );
}

function savedPercent(fmt: Fmt, savings: number, digits = 1) {
  return savings === 0 ? fmt.pct(0, digits) : fmt.pct(-savings, digits).replace("-", "−");
}

/** Bytes that left the device as "0 B", "812 B" or "14.2 KB". */
function byteSize(t: ReturnType<typeof useI18n>["t"], fmt: Fmt, bytes: number) {
  return bytes < 1024 ? t("common.bytes", { value: bytes }) : t("common.kb", { value: fmt.num(bytes / 1024, 1) });
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
  const { t, rich, fmt } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [localComparisons, setLocalComparisons] = useState<Record<string, NaiveComparison>>({});
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<Record<string, Text>>({});

  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const comparisons = externalComparisons ?? localComparisons;
  const stats = totals(entries, comparisons);

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
  const maxTokens = Math.max(stats.naive, stats.ours, 1);

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
          ? msg("inspector.noKey")
          : res.error ?? msg("inspector.compareFailed"),
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

  const baselineTag = stats.measuredCount > 0 && stats.liveNaiveCount === stats.measuredCount
    ? t("inspector.tagMeasuredLive")
    : stats.liveNaiveCount > 0
      ? t("inspector.tagMixed", { measured: stats.liveNaiveCount, estimated: stats.measuredCount - stats.liveNaiveCount })
      : t("inspector.tagEstimated", { model: t("inspector.naiveModel") });

  // What stayed on the device: calls that sent nothing, and the bytes of those that did.
  const bytesSent = entries.reduce((sum, e) => sum + (e.bytesSent ?? 0), 0);
  const cloudCount = entries.filter((e) => (e.bytesSent ?? 0) > 0 || e.usage.mode === "llm").length;
  const localCount = entries.length - cloudCount;
  // "Measured" only when every counted call has a live GPT-4o run behind it; otherwise the baseline is an estimate.
  const savingMeasured = stats.measuredCount > 0 && stats.liveNaiveCount === stats.measuredCount;

  const per1kOurs = stats.snapCount > 0 ? (stats.snapOursCost / stats.snapCount) * 1000 : null;
  const per1kNaive = stats.snapCount > 0 ? (stats.snapNaiveCost / stats.snapCount) * 1000 : null;

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
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id={titleId} className="min-w-0 font-serif text-2xl leading-tight sm:text-3xl">
              {t("inspector.title")}
            </h2>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label={t("inspector.closeAria")}
              className="shrink-0 rounded-full border border-line px-3 py-1 text-sm text-ink-2 transition hover:border-ink-3 hover:text-ink"
            >
              {t("common.close")}
            </button>
          </div>

          {/* Summary: calls, tokens and cost, what left the device, saving against the naive baseline */}
          <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" data-testid="inspector-summary">
            <Stat label={t("ux.insp.calls")} value={fmt.int(entries.length)} sub={t("ux.insp.local", { count: localCount })} />
            <Stat label={t("ux.insp.tokens")} value={fmt.int(stats.ours)} sub={fmt.usd(stats.oursCost)} />
            <Stat
              label={t("ux.insp.sent")}
              value={byteSize(t, fmt, bytesSent)}
              sub={cloudCount > 0 ? t("ux.insp.cloud", { count: cloudCount }) : t("ux.insp.nothingSent")}
            />
            <Stat
              label={t(savingMeasured ? "ux.insp.savingMeasured" : "ux.insp.savingEstimated")}
              value={stats.tokenSavedPct !== null ? savedPercent(fmt, stats.tokenSavedPct) : "—"}
              sub={stats.costSavedPct !== null ? t("ux.insp.cost", { p: savedPercent(fmt, stats.costSavedPct) }) : t("inspector.savingsEmpty")}
              accent
            />
          </dl>

          {/* Calls: one line each, the detail behind the row */}
          {entries.length === 0 ? (
            <p className="mb-4 text-sm text-ink-2">{t("inspector.emptyAll")}</p>
          ) : (
            <>
              {measuredEntries.length > 0 && (
                <ul className="mb-4 space-y-2">
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
              {excludedEntries.length > 0 && (
                <div className="mb-4">
                  <div className="label mb-2 text-warn">{t("inspector.excluded", { count: excludedEntries.length })}</div>
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
            </>
          )}

          {/* Method: the cascade, the baseline and the unit figures, one click away */}
          <Disclosure summary={t("ux.insp.method")} testId="inspector-method">
            <div className="space-y-4 text-xs">
              {stats.measuredCount > 0 && (
                <div className="space-y-2">
                  <Bar label={t("inspector.barNaive")} value={stats.naive} max={maxTokens} color="var(--ink-3)" />
                  <Bar label="Doppel" value={stats.ours} max={maxTokens} color="var(--frugal)" />
                  <p className="text-ink-2">{t("inspector.naiveBaseline", { tag: baselineTag })} · {t("inspector.formula")}</p>
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Explain chip="0" route="qr" title={t("inspector.tier0Title")} text={t("inspector.tier0Text")} />
                <Explain chip="1" route="text-llm" title={t("inspector.tier1Title")} text={t("inspector.tier1Text")} />
                <Explain chip="2" route="vision-llm" title={t("inspector.tier2Title")} text={t("inspector.tier2Text")} />
              </div>
              <ul className="space-y-1 text-ink-2">
                <li>{t("inspector.baselineNote")}</li>
                <li>{t("inspector.excludedNote")}</li>
                {per1kOurs !== null && per1kNaive !== null && (
                  <li className="num">
                    {t("inspector.per1k", { n: 1000 })}:{" "}
                    {rich("inspector.per1kLine", {
                      ours: <b className="text-frugal">{fmt.usd(per1kOurs)}</b>,
                      naive: <b className="text-ink">{fmt.usd(per1kNaive)}</b>,
                    })}{" "}
                    {t("inspector.per1kBasis", { count: stats.snapCount })}
                  </li>
                )}
                {stats.measuredCount > 0 && (
                  <li className="num">
                    {t("inspector.energy")}:{" "}
                    {rich("inspector.energyLine", {
                      ours: <b className="text-frugal">{t("common.wh", { value: fmt.num(stats.oursWh, 3) })}</b>,
                      naive: <b className="text-ink">{t("common.wh", { value: fmt.num(stats.naiveWh, 3) })}</b>,
                    })}
                  </li>
                )}
                <li>{t("inspector.energyNote")}</li>
              </ul>
            </div>
          </Disclosure>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <dt className="label">{label}</dt>
      <dd className={`num mt-1 text-xl font-semibold ${accent ? "text-frugal" : ""}`}>{value}</dd>
      <dd className="num text-xs text-ink-2">{sub}</dd>
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
  compareError?: Text;
  onCompare: () => void;
}) {
  const { t, tm, fmt, rich } = useI18n();
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
        <span className="flex-1 sm:flex-none"><TierChip tier={e.tier} route={route} /></span>
        {/* Below `sm` the title takes its own line under the chip, so it is not cut to a few letters. */}
        <span className="order-last min-w-0 basis-full truncate text-sm font-medium sm:order-none sm:flex-1 sm:basis-0">{tm(e.title)}</span>
        <OutcomeTag outcome={outcome} excluded={excluded} />
        {comparison && (
          <span className="rounded-full bg-s1/15 px-2 py-0.5 text-[10px] font-semibold text-s1">
            {t("inspector.gpt4oMeasured")}
          </span>
        )}
        <span className="num text-xs font-semibold">
          {!usageKnown && e.usage.mode === "llm" ? t("inspector.usageUnknown") : t("inspector.tok", { count: oursTok })}
        </span>
      </button>

      {!!e.receiptItems?.length && (
        <div className="px-3 pb-2">
          <ReceiptDetails items={e.receiptItems} total={e.extractedAmount} currency={e.receiptCurrency} />
        </div>
      )}
      {isOpen && (
        <div id={panelId} className="space-y-3 border-t border-line px-3 py-3 text-xs">
          {!excluded && (
            <p className="num text-ink-2">
              {t("common.ms", { value: fmt.int(Math.round(e.ms)) })} · {t(comparison ? "inspector.measuredTitle" : "inspector.estimatedTitle")}: {t("inspector.tok", { count: naiveTok })}
            </p>
          )}
          {e.steps && e.steps.length > 0 && (
            <ol className="space-y-1">
              {e.steps.map((s, i) => (
                <li key={i} className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="num w-14 shrink-0 text-right text-ink-3">{t("common.ms", { value: Math.round(s.ms) })}</span>
                  <span className="font-medium">{tm(s.name)}</span>
                  {s.detail && <span className="text-ink-2 break-words">{tm(s.detail)}</span>}
                </li>
              ))}
            </ol>
          )}

          {/* Metadata grid */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-surface-2/70 p-2.5">
              <div className="text-[11px] font-semibold text-ink-3">
                {t("inspector.oursHeader", { state: msg(e.usage.mode === "offline" ? "inspector.stateOffline" : usageKnown ? "inspector.stateMeasured" : "inspector.usageUnknown") })}
              </div>
              <div className="mt-1 break-words text-ink">
                {e.usage.model} ·{" "}
                {!usageKnown && e.usage.mode === "llm" ? (
                  <span className="text-warn">{t("inspector.usageUnknown")}</span>
                ) : (
                  <span className="num">
                    {t("inspector.inOut", { in: e.usage.promptTokens, out: e.usage.completionTokens })} · {fmt.usd(e.usage.costUsd)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-ink-2">
                {t("inspector.route", { route: msg(`route.${route}`) })} ·{" "}
                {rich("inspector.leftDevice", {
                  size: <span className="num font-medium">{e.bytesSent == null ? "—" : byteSize(t, fmt, e.bytesSent)}</span>,
                })}
                {e.imageSize && t("inspector.input", { size: `${e.imageSize.width}×${e.imageSize.height}` })}
              </div>
              {e.fieldsMissing && e.fieldsMissing.length > 0 && (
                <div className="mt-0.5 text-warn">{t("inspector.missingFields", {
                  fields: e.fieldsMissing.map((field) => field === "kind" ? t("review.docType")
                    : field === "amount" ? t("inspector.rowAmount") : field === "items" ? t("receipt.items") : field).join(", "),
                })}</div>
              )}
            </div>

            <div className="rounded-lg bg-surface-2/70 p-2.5">
              <div className="text-[11px] font-semibold text-ink-3">
                {t("inspector.naiveHeader", { state: msg(comparison ? "inspector.stateLive" : "inspector.stateEstimated") })}
              </div>
              <div className="mt-1 break-words text-ink">
                {comparison ? (
                  <span className="num">
                    {comparison.model} · {t("inspector.inOut", { in: comparison.promptTokens, out: comparison.completionTokens })} ·{" "}
                    {fmt.usd(comparison.costUsd)} · {t("common.ms", { value: Math.round(comparison.ms) })}
                  </span>
                ) : (
                  <span>
                    {tm(e.naive.description)} · <span className="num font-medium">{fmt.usd(naiveCost)}</span>
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
                  <span className="font-medium text-ink">{t("inspector.liveCheck")}</span>
                  <span className="ml-1.5 text-ink-2">
                    {t("inspector.liveCheckText")}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={comparing}
                  onClick={onCompare}
                  className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink transition hover:border-s1 hover:text-s1 disabled:opacity-50"
                >
                  {t(comparing ? "inspector.running" : comparison ? "inspector.rerun" : "inspector.run")}
                </button>
              </div>

              {compareError && <p className="mt-2 text-xs text-warn">{tm(compareError)}</p>}

              {comparison && (
                <div className="mt-2.5 overflow-x-auto">
                  <table className="w-full min-w-[260px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-[11px] text-ink-3">
                        <th className="py-1 pr-2 font-medium">{t("inspector.colMetric")}</th>
                        <th className="py-1 pr-2 font-medium">Doppel</th>
                        <th className="py-1 pr-2 font-medium">{t("inspector.colNaive")}</th>
                        <th className="py-1 font-medium">{t("inspector.colComparison")}</th>
                      </tr>
                    </thead>
                    <tbody className="num divide-y divide-line/60">
                      <tr>
                        <td className="py-1 pr-2 font-sans text-ink-2">{t("inspector.rowTokens")}</td>
                        <td className="py-1 pr-2 font-medium">
                          {!usageKnown && e.usage.mode === "llm" ? t("inspector.unknown") : fmt.int(oursTok)}
                        </td>
                        <td className="py-1 pr-2">{fmt.int(naiveTok)}</td>
                        <td className="py-1 font-semibold text-frugal">
                          {naiveTok > 0 && usageKnown
                            ? savedPercent(fmt, 1 - oursTok / naiveTok)
                            : "—"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2 font-sans text-ink-2">{t("inspector.rowCost")}</td>
                        <td className="py-1 pr-2 font-medium">{fmt.usd(e.usage.costUsd)}</td>
                        <td className="py-1 pr-2">{fmt.usd(comparison.costUsd)}</td>
                        <td className="py-1 font-semibold text-frugal">
                          {comparison.costUsd > 0 && usageKnown
                            ? savedPercent(fmt, 1 - e.usage.costUsd / comparison.costUsd)
                            : "—"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2 font-sans text-ink-2">{t("inspector.rowLatency")}</td>
                        <td className="py-1 pr-2">{t("common.ms", { value: Math.round(e.ms) })}</td>
                        <td className="py-1 pr-2">{t("common.ms", { value: Math.round(comparison.ms) })}</td>
                        <td className="py-1 text-ink-2">
                          {e.ms <= comparison.ms
                            ? t("inspector.faster", { x: fmt.num(comparison.ms / Math.max(1, e.ms), 1) })
                            : t("inspector.slower", { ms: Math.round(e.ms - comparison.ms) })}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2 font-sans text-ink-2">{t("inspector.rowAmount")}</td>
                        <td className="py-1 pr-2">
                          {e.extractedAmount != null ? fmt.chf(e.extractedAmount) : "—"}
                        </td>
                        <td className="py-1 pr-2">
                          {comparison.extractedAmount != null ? fmt.chf(comparison.extractedAmount) : "—"}
                        </td>
                        <td className="py-1 font-sans">
                          {comparison.amountMatches === true && (
                            <span className="font-semibold text-good">{t("inspector.sameAmount")}</span>
                          )}
                          {comparison.amountMatches === false && (
                            <span className="font-semibold text-bad">{t("inspector.differs")}</span>
                          )}
                          {comparison.amountMatches === null && <span className="text-ink-3">{t("inspector.na")}</span>}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {e.visionReason && (
            <div className="rounded-lg border border-s1/30 bg-s1/5 p-2.5">
              <div className="text-[11px] font-semibold text-s1">{t("vision.whyHeading")}</div>
              <div className="mt-0.5 break-words text-ink">{tm(e.visionReason)}</div>
            </div>
          )}

          {e.preview && (
            <div>
              <div className="mb-1 text-ink-3">
                {t("inspector.previewTitle")}
                {e.cropSize ? ` (${e.cropSize.width}×${e.cropSize.height})` : ""}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.preview} alt={t("inspector.previewAlt")} className="h-32 rounded border border-line" />
            </div>
          )}

          <div>
            <div className="text-ink-3">
              {t(e.usage.mode === "llm" ? "inspector.payloadCloud" : "inspector.payloadLocal")}
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
  const { t } = useI18n();
  if (excluded === "offline") {
    return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-semibold text-warn">{t("inspector.outcomeOffline")}</span>;
  }
  if (excluded === "usage-unknown") {
    return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-semibold text-warn">{t("inspector.usageUnknown")}</span>;
  }
  if (outcome === "failed") {
    return <span className="rounded-full bg-bad/15 px-2 py-0.5 text-[10px] font-semibold text-bad">{t("inspector.outcomeFailed")}</span>;
  }
  if (outcome === "partial") {
    return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-semibold text-warn">{t("inspector.outcomePartial")}</span>;
  }
  return <span className="text-[11px] text-good">{t("inspector.outcomeOk")}</span>;
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const { fmt } = useI18n();
  return (
    <div className="flex items-center gap-2 text-xs sm:gap-3">
      <span className="w-12 shrink-0 text-ink-2 sm:w-14">{label}</span>
      <div className="h-3 flex-1 rounded-full bg-surface-2">
        <div className="h-3 rounded-full" style={{ width: `${Math.max(0.8, (value / max) * 100)}%`, background: color }} />
      </div>
      <span className="num w-16 shrink-0 text-right font-medium sm:w-20">{fmt.int(value)}</span>
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
