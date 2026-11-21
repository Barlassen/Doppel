"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Text } from "@/lib/i18n/types";
import { DOC_KINDS, MAX_AMOUNT, isAmount, type DocKind, type Extraction, type SnapResult } from "@/lib/snap/types";
import {
  reverifyChart,
  reverifyFloorPlan,
  type FloorPlanVerification,
} from "@/lib/snap/vision";
import { TierChip } from "./Inspector";

const editField = "w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";

export function VisionReviewCard({
  name,
  result,
  onConfirm,
  onDiscard,
}: {
  name: Text;
  result: SnapResult;
  onConfirm: (e: Extraction) => void;
  onDiscard: () => void;
}) {
  const { t, tm, fmt } = useI18n();
  const [draft, setDraft] = useState<Extraction>(result.extraction);
  const [equitiesInput, setEquitiesInput] = useState<number | undefined>(() =>
    result.extraction.vision?.kind === "chart"
      ? result.extraction.vision.chart.allocation?.equitiesPct
      : undefined,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const vision = draft.vision;
  const floorPlan =
    vision?.kind === "floorplan"
      ? reverifyFloorPlan(vision.floorPlan, {
          priceChf: draft.amount,
          location: draft.location,
          rooms: draft.rooms,
          livingAreaM2: draft.areaM2,
        })
      : undefined;

  const chart =
    vision?.kind === "chart"
      ? reverifyChart(vision.chart, {
          latestValueChf: draft.amount,
          equitiesPct: equitiesInput,
        })
      : undefined;

  const isChart = vision?.kind === "chart";
  const needKind = !isChart && draft.kind === "other";
  const hasValidAmount = isAmount(draft.amount) && draft.amount > 0;
  const needAmount = isChart
    ? !hasValidAmount && !chart?.allocation
    : !hasValidAmount;

  function update<K extends keyof Extraction>(key: K, value: Extraction[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
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
        if (!needKind && !needAmount) {
          const nextVision =
            vision?.kind === "floorplan" && floorPlan
              ? { ...vision, floorPlan }
              : vision?.kind === "chart" && chart
                ? { ...vision, chart }
                : vision;
          onConfirm({
            ...draft,
            amount: isChart ? chart?.latestValueChf : draft.amount,
            vision: nextVision,
          });
        }
      }}
    >
      <div>
        <h3 ref={heading} tabIndex={-1} className="break-words text-sm font-semibold">
          {t("review.heading", { name })}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TierChip tier={result.tier} route={result.route} />
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
            {t(`snapRoute.${result.route}`)}
          </span>
          {result.ocrConfidence !== undefined && (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
              {t("review.ocr", { p: result.ocrConfidence / 100 })}
            </span>
          )}
        </div>
      </div>

      {result.visionReason && (
        <div className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink-2">
          <div className="font-semibold text-ink">{t("vision.whyHeading")}</div>
          <p className="mt-0.5 break-words">{tm(result.visionReason)}</p>
        </div>
      )}

      {floorPlan && (
        <div className="space-y-2 rounded-lg border border-s1/30 bg-s1/5 p-2.5 text-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-s1">
            {t("vision.planBadge")}
          </div>
          <div className="num break-words text-sm font-semibold text-ink" data-testid="vision-plan-headline">
            {tm(floorPlan.headline)}
          </div>

          <div className="space-y-1">
            {floorPlan.checks.map((c, idx) => (
              <p key={idx} className="break-words text-good">
                {tm(c)}
              </p>
            ))}
            {floorPlan.warnings.map((w, idx) => (
              <p key={idx} className="break-words font-medium text-warn" data-testid="vision-plan-warning">
                {tm(w)}
              </p>
            ))}
          </div>

          <div className="border-t border-line/70 pt-2">
            <div className="mb-1 font-medium text-ink-2">
              {t("vision.roomsTableTitle", {
                count: floorPlan.roomList.length,
                sum: floorPlan.computedLivingAreaM2,
              })}
            </div>
            <ul className="grid grid-cols-1 gap-1">
              {floorPlan.roomList.map((r, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-baseline justify-between gap-1.5 rounded bg-surface px-2 py-1 text-[11px]"
                >
                  <span className="min-w-0 truncate font-medium text-ink">
                    {r.name}
                    {r.roomUnits > 0 && (
                      <span className="ml-1 text-ink-3">
                        ({t("vision.roomCount", { count: r.roomUnits })})
                      </span>
                    )}
                  </span>
                  <span className="num text-ink-2">
                    {r.fromDimensions && r.widthM && r.lengthM
                      ? t("vision.roomFromDims", {
                          dims: `${r.widthM.toFixed(2)}×${r.lengthM.toFixed(2)}`,
                          area: r.areaM2,
                        })
                      : `${r.areaM2} m²`}
                  </span>
                </li>
              ))}
            </ul>
            {floorPlan.balconyAreaM2 > 0 && (
              <p className="mt-1.5 text-[11px] text-ink-3">
                {t("vision.balconyArea", { area: floorPlan.balconyAreaM2 })}
              </p>
            )}
            {floorPlan.regional && (
              <p className="mt-1 text-[11px] text-ink-3">
                {t("vision.medianFootnote", {
                  region: floorPlan.regional.region,
                  median: floorPlan.regional.medianChfPerM2,
                })}
              </p>
            )}
          </div>
        </div>
      )}

      {chart && (
        <div className="space-y-2 rounded-lg border border-s1/30 bg-s1/5 p-2.5 text-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-s1">
            {t("vision.chartBadge")}
          </div>
          <div className="num break-words text-sm font-semibold text-ink" data-testid="vision-chart-headline">
            {tm(chart.headline)}
          </div>

          <div className="space-y-1">
            {chart.checks.map((c, idx) => (
              <p key={idx} className="break-words text-good">
                {tm(c)}
              </p>
            ))}
            {chart.warnings.map((w, idx) => (
              <p key={idx} className="break-words font-medium text-warn" data-testid="vision-chart-warning">
                {tm(w)}
              </p>
            ))}
          </div>

          {chart.allocation && (
            <div className="border-t border-line/70 pt-2">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1 font-medium text-ink-2">
                <span>
                  {t("vision.allocTitle", {
                    sum: (chart.allocationSumPct ?? 100) / 100,
                  })}
                </span>
                {chart.derivedRiskProfile && (
                  <span className="rounded-full bg-s1/15 px-2 py-0.5 text-[11px] font-semibold text-s1">
                    {t("vision.derivedRiskLabel", { risk: t(`risk.${chart.derivedRiskProfile}`) })}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                <div className="flex items-baseline justify-between gap-1.5 rounded bg-surface px-2 py-1">
                  <span className="min-w-0 truncate text-ink-2">{t("vision.sliceEquities")}</span>
                  <span className="num shrink-0 font-semibold text-ink">{fmt.pct(chart.allocation.equitiesPct / 100, 0)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-1.5 rounded bg-surface px-2 py-1">
                  <span className="min-w-0 truncate text-ink-2">{t("vision.sliceBonds")}</span>
                  <span className="num shrink-0 font-semibold text-ink">{fmt.pct(chart.allocation.bondsPct / 100, 0)}</span>
                </div>
                {chart.allocation.realEstatePct > 0 && (
                  <div className="flex items-baseline justify-between gap-1.5 rounded bg-surface px-2 py-1">
                    <span className="min-w-0 truncate text-ink-2">{t("vision.sliceRealEstate")}</span>
                    <span className="num shrink-0 font-semibold text-ink">{fmt.pct(chart.allocation.realEstatePct / 100, 0)}</span>
                  </div>
                )}
                {chart.allocation.cashPct > 0 && (
                  <div className="flex items-baseline justify-between gap-1.5 rounded bg-surface px-2 py-1">
                    <span className="min-w-0 truncate text-ink-2">{t("vision.sliceCash")}</span>
                    <span className="num shrink-0 font-semibold text-ink">{fmt.pct(chart.allocation.cashPct / 100, 0)}</span>
                  </div>
                )}
                {chart.allocation.otherPct > 0 && (
                  <div className="flex items-baseline justify-between gap-1.5 rounded bg-surface px-2 py-1">
                    <span className="min-w-0 truncate text-ink-2">{t("vision.sliceOther")}</span>
                    <span className="num shrink-0 font-semibold text-ink">{fmt.pct(chart.allocation.otherPct / 100, 0)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {chart.series.length >= 2 && (
            <div className="border-t border-line/70 pt-2">
              <div className="mb-1 font-medium text-ink-2">
                {t("vision.seriesTitle", {
                  count: chart.series.length,
                  from: chart.series[0].month,
                  to: chart.series[chart.series.length - 1].month,
                })}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {chart.series.map((pt) => (
                  <span key={pt.month} className="num rounded bg-surface px-1.5 py-0.5 text-ink-2">
                    {pt.month.slice(5)}: <b className="text-ink">{fmt.chfShort(pt.valueChf)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(needKind || (needAmount && result.fieldsMissing?.includes("amount")) || (!isChart && draft.amount === 0)) && (
        <p className="text-xs text-warn">
          {t(needKind ? "review.needKind" : draft.amount === 0 ? "review.needPositive" : "review.noAmount")}
        </p>
      )}

      {isChart ? (
        <div className="grid gap-2 text-xs font-medium text-ink-2 sm:grid-cols-2">
          <label className="min-w-0">
            {t("vision.portfolioValueField")}
            <input
              className={editField}
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_AMOUNT}
              step="100"
              value={draft.amount ?? ""}
              onChange={(e) =>
                update("amount", isAmount(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : undefined)
              }
            />
          </label>
          <label className="min-w-0">
            {t("vision.equitiesPctField")}
            <input
              className={editField}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={1}
              value={equitiesInput ?? ""}
              onChange={(e) =>
                setEquitiesInput(
                  e.currentTarget.value && Number.isFinite(e.currentTarget.valueAsNumber)
                    ? e.currentTarget.valueAsNumber
                    : undefined,
                )
              }
            />
          </label>
          <label className="min-w-0 sm:col-span-2">
            {t("review.label")}
            <input
              className={editField}
              maxLength={80}
              value={tm(draft.labelMsg ?? draft.label)}
              onChange={(e) => {
                const label = e.currentTarget.value || undefined;
                setDraft((prev) => ({ ...prev, label, labelMsg: undefined }));
              }}
            />
          </label>
        </div>
      ) : (
        <div className="grid gap-2 text-xs font-medium text-ink-2 sm:grid-cols-2">
          <label className="min-w-0">
            {t("review.docType")}
            <select
              className={editField}
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as DocKind;
                setDraft((prev) => ({ ...prev, kind, category: kind === prev.kind ? prev.category : undefined }));
              }}
            >
              {DOC_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kind.${kind}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            {t("review.amount")}
            <input
              className={editField}
              type="number"
              inputMode="decimal"
              min={0.01}
              max={MAX_AMOUNT}
              step="0.01"
              required
              value={draft.amount ?? ""}
              onChange={(e) =>
                update("amount", isAmount(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : undefined)
              }
            />
          </label>
          <label className="min-w-0">
            {t("review.label")}
            <input
              className={editField}
              maxLength={80}
              value={tm(draft.labelMsg ?? draft.label)}
              onChange={(e) => {
                const label = e.currentTarget.value || undefined;
                setDraft((prev) => ({ ...prev, label, labelMsg: undefined }));
              }}
            />
          </label>
          <label className="min-w-0">
            {t("review.location")}
            <input
              className={editField}
              maxLength={80}
              value={draft.location ?? ""}
              onChange={(e) => update("location", e.target.value || undefined)}
            />
          </label>
          <label className="min-w-0">
            {t("review.rooms")}
            <input
              className={editField}
              type="number"
              inputMode="decimal"
              min={0.5}
              max={100}
              step={0.5}
              value={draft.rooms ?? ""}
              onChange={(e) => update("rooms", e.currentTarget.value ? e.currentTarget.valueAsNumber : undefined)}
            />
          </label>
          <label className="min-w-0">
            {t("vision.livingArea")}
            <input
              className={editField}
              type="number"
              inputMode="decimal"
              min={10}
              max={2000}
              step={0.5}
              value={draft.areaM2 ?? ""}
              onChange={(e) => update("areaM2", e.currentTarget.value ? e.currentTarget.valueAsNumber : undefined)}
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-ink-3"
        >
          {t("review.discard")}
        </button>
        <button
          type="submit"
          disabled={needKind || needAmount}
          className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-45"
        >
          {t("review.add")}
        </button>
      </div>
    </form>
  );
}

export function FloorPlanAffordabilitySummary({
  floorPlan,
  price,
}: {
  floorPlan: FloorPlanVerification;
  price: number;
}) {
  const { t, tm } = useI18n();
  const updated = reverifyFloorPlan(floorPlan, { priceChf: price });
  return (
    <div className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs" data-testid="afford-floorplan">
      <div className="num font-semibold text-ink">{tm(updated.headline)}</div>
      {updated.warnings.map((w, idx) => (
        <p key={idx} className="mt-1 text-warn">
          {tm(w)}
        </p>
      ))}
      {updated.regional && (
        <p className="mt-1 text-[11px] text-ink-3">
          {t("vision.medianFootnote", {
            region: updated.regional.region,
            median: updated.regional.medianChfPerM2,
          })}
        </p>
      )}
    </div>
  );
}
