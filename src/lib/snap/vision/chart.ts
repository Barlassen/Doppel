import { colorDistance, type DonutMeasurement } from "./donut";
import type { BehaviorInsight, BehaviorProfile } from "@/lib/finance/behavioralEngine";
import type { Profile, RiskProfile, Scenario } from "@/lib/finance/types";
import { msg, type Msg } from "@/lib/i18n/types";

/**
 * Portfolio / 3a / pension chart schema validation, deterministic TypeScript verification,
 * and minimal twin application hook.
 *
 * The vision model ONLY reads:
 *   1. Donut / pie allocation shares (equities, bonds, cash, real estate, other) in %.
 *   2. Unlabeled portfolio value line-chart points ({ month: "YYYY-MM", valueChf }) using axis ticks for scale.
 *   3. Any printed total portfolio / 3a balance (CHF) and provider / account label.
 *
 * All verification and financial calculations run deterministically in TypeScript (0 tokens):
 *   - Allocation shares sum to 100 ± 2 percentage points.
 *   - Time-series points are checked for monotonicity in time (YYYY-MM).
 *   - Chart endpoint is checked against any printed total (±5% axis-reading tolerance).
 *   - Peak-to-trough drawdowns of ≥ 10% are computed deterministically from the series.
 *   - Equity share maps deterministically to Doppel's risk profile (conservative / balanced / growth).
 */

export const ALLOCATION_SUM_TOLERANCE_PP = 2;
export const ENDPOINT_TOTAL_TOLERANCE = 0.05;
export const DRAWDOWN_THRESHOLD = 0.1;

export interface ChartAllocation {
  equitiesPct: number;
  bondsPct: number;
  cashPct: number;
  realEstatePct: number;
  otherPct: number;
}

export interface LegendEntry { assetClass: "equities" | "bonds" | "cash" | "realEstate" | "other"; label: string; colorHex: string }
export function parseLegend(raw: unknown): LegendEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 8) return undefined;
  if (!raw.every(e => e && typeof e === "object" && ["equities","bonds","cash","realEstate","other"].includes(e.assetClass) && typeof e.label === "string" && e.label.length <= 100 && /^#[0-9a-f]{6}$/i.test(e.colorHex))) return undefined;
  return raw as LegendEntry[];
}
export function withPixelAllocation(ext: ChartExtraction, pixels?: DonutMeasurement): ChartExtraction {
  if (!ext.legend && !ext.allocation) return ext;
  const fallback = { ...ext, pixelStatus: "fallback" as const };
  if (!pixels || pixels.quality < 0.94 || pixels.clusters.length !== ext.legend?.length) return fallback;
  const allocation: ChartAllocation = {equitiesPct:0,bondsPct:0,cashPct:0,realEstatePct:0,otherPct:0};
  const used = new Set<number>();
  for (const c of pixels.clusters) {
    const ranked = ext.legend.map((e,i)=>({i,d:colorDistance(c.colorHex,e.colorHex)})).sort((a,b)=>a.d-b.d);
    if (ranked[0].d > 65 || ranked[1].d - ranked[0].d < 20 || used.has(ranked[0].i)) return fallback;
    used.add(ranked[0].i);
    allocation[`${ext.legend[ranked[0].i].assetClass}Pct`] += c.share;
  }
  const disagreement = ext.allocation && Object.keys(allocation).some(k=> Math.abs(allocation[k as keyof ChartAllocation]-(ext.allocation?.[k as keyof ChartAllocation] ?? 0))>10);
  return {...ext, allocation, pixelMeasurement: pixels, pixelStatus: disagreement ? "disagreement" : "measured"};
}

export interface ChartSeriesPoint {
  /** ISO month "YYYY-MM". */
  month: string;
  /** Approximate portfolio value in CHF read against the chart's y-axis ticks. */
  valueChf: number;
}

export interface ChartDrawdown {
  peakMonth: string;
  peakChf: number;
  troughMonth: string;
  troughChf: number;
  /** Fraction in 0..1, e.g. 0.181 for an 18.1% peak-to-trough drawdown. */
  drawdownPct: number;
  recoveredMonth: string | null;
}

export interface ChartExtraction {
  legend?: LegendEntry[];
  pixelMeasurement?: DonutMeasurement;
  pixelStatus?: "measured" | "fallback" | "disagreement";
  accountType?: "portfolio" | "pillar3a" | "pension";
  provider?: string;
  printedTotalChf?: number;
  allocation?: Partial<ChartAllocation>;
  series?: ChartSeriesPoint[];
  label?: string;
}

export interface ChartVerification {
  pixelMeasurement?: DonutMeasurement;
  accountType: "portfolio" | "pillar3a" | "pension";
  provider?: string;
  allocation?: ChartAllocation;
  allocationSumPct?: number;
  allocationValid?: boolean;
  derivedRiskProfile?: RiskProfile;
  series: ChartSeriesPoint[];
  isMonotoneInTime: boolean;
  printedTotalChf?: number;
  endpointValueChf?: number;
  endpointMatchesTotal?: boolean;
  /** Final portfolio value used when applying to the twin (printed total if verified, else latest point). */
  latestValueChf?: number;
  maxDrawdown?: ChartDrawdown;
  /** Populated when maxDrawdown.drawdownPct >= 10% (DRAWDOWN_THRESHOLD). */
  significantDrawdown?: ChartDrawdown;
  headline: Msg;
  checks: Msg[];
  warnings: Msg[];
}

export interface ChartTwinPatch {
  riskProfile?: RiskProfile;
  equitiesPct?: number;
  portfolioChf?: number;
  drawdown?: ChartDrawdown;
  insight?: BehaviorInsight;
  summary: Msg;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Maps an equity allocation share (0..100%) to Doppel's discrete RiskProfile.
 * Doppel's simulator uses 30% (conservative), 50% (balanced), and 80% (growth).
 */
export function riskProfileFromEquitiesPct(equitiesPct: number): RiskProfile {
  if (equitiesPct >= 62) return "growth";
  if (equitiesPct >= 40) return "balanced";
  return "conservative";
}

/**
 * Computes the worst peak-to-trough drawdown across a chronologically ordered series in TypeScript.
 */
export function computePeakToTroughDrawdown(series: readonly ChartSeriesPoint[]): ChartDrawdown | undefined {
  if (series.length < 2) return undefined;
  let runningPeak = series[0];
  let bestPeak = series[0];
  let bestTrough = series[0];
  let maxDd = 0;
  let bestPeakIdx = 0;
  let bestTroughIdx = 0;

  for (let i = 1; i < series.length; i++) {
    const pt = series[i];
    if (pt.valueChf > runningPeak.valueChf) {
      runningPeak = pt;
    } else if (runningPeak.valueChf > 0) {
      const dd = (runningPeak.valueChf - pt.valueChf) / runningPeak.valueChf;
      if (dd > maxDd) {
        maxDd = dd;
        bestPeak = runningPeak;
        bestTrough = pt;
        bestPeakIdx = series.indexOf(runningPeak);
        bestTroughIdx = i;
      }
    }
  }

  if (maxDd <= 0 || bestTroughIdx <= bestPeakIdx) return undefined;

  let recoveredMonth: string | null = null;
  for (let i = bestTroughIdx + 1; i < series.length; i++) {
    if (series[i].valueChf >= bestPeak.valueChf) {
      recoveredMonth = series[i].month;
      break;
    }
  }

  return {
    peakMonth: bestPeak.month,
    peakChf: Math.round(bestPeak.valueChf),
    troughMonth: bestTrough.month,
    troughChf: Math.round(bestTrough.valueChf),
    drawdownPct: Math.round(maxDd * 1000) / 1000,
    recoveredMonth,
  };
}

/**
 * Deterministic verification of a chart extraction in TypeScript (0 tokens, no LLM math).
 */
export function verifyChart(ext: ChartExtraction): ChartVerification {
  const checks: Msg[] = [];
  const warnings: Msg[] = [];

  if (ext.pixelStatus === "fallback") warnings.push(msg("vision.pixelFallback"));
  if (ext.pixelStatus === "measured" || ext.pixelStatus === "disagreement") checks.push(msg("vision.pixelMeasured"));
  if (ext.pixelStatus === "disagreement") checks.push(msg("vision.pixelDisagreement"));
  // 1. Allocation shares sum to 100 ± 2
  let allocation: ChartAllocation | undefined;
  let allocationSumPct: number | undefined;
  let allocationValid: boolean | undefined;
  let derivedRiskProfile: RiskProfile | undefined;

  if (ext.allocation) {
    const eq = round1(Math.max(0, ext.allocation.equitiesPct ?? 0));
    const bo = round1(Math.max(0, ext.allocation.bondsPct ?? 0));
    const ca = round1(Math.max(0, ext.allocation.cashPct ?? 0));
    const re = round1(Math.max(0, ext.allocation.realEstatePct ?? 0));
    const ot = round1(Math.max(0, ext.allocation.otherPct ?? 0));
    const sum = round1(eq + bo + ca + re + ot);

    if (sum > 0) {
      allocation = {
        equitiesPct: eq,
        bondsPct: bo,
        cashPct: ca,
        realEstatePct: re,
        otherPct: ot,
      };
      allocationSumPct = sum;
      allocationValid = Math.abs(sum - 100) <= ALLOCATION_SUM_TOLERANCE_PP;
      derivedRiskProfile = riskProfileFromEquitiesPct(eq);

      if (allocationValid) {
        checks.push(
          msg("vision.verifyAllocOk", {
            sum: sum / 100,
            equities: eq / 100,
            risk: msg(`risk.${derivedRiskProfile}`),
          }),
        );
      } else {
        warnings.push(
          msg("vision.warnAllocSum", {
            sum: sum / 100,
          }),
        );
      }
    }
  }

  // 2. Time-series monotonicity & sorting
  const rawSeries = (ext.series ?? []).filter(
    (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month) && Number.isFinite(p.valueChf) && p.valueChf > 0,
  );
  let isMonotoneInTime = true;
  for (let i = 1; i < rawSeries.length; i++) {
    if (rawSeries[i].month <= rawSeries[i - 1].month) {
      isMonotoneInTime = false;
      break;
    }
  }

  const series = [...rawSeries]
    .sort((a, b) => a.month.localeCompare(b.month))
    .filter((pt, idx, arr) => idx === 0 || pt.month !== arr[idx - 1].month);

  if (rawSeries.length >= 2) {
    if (isMonotoneInTime) {
      checks.push(
        msg("vision.verifyMonotoneOk", {
          count: series.length,
          from: series[0].month,
          to: series[series.length - 1].month,
        }),
      );
    } else {
      warnings.push(msg("vision.warnNonMonotone"));
    }
  }

  // 3. Chart endpoint vs printed total
  const printedTotalChf =
    typeof ext.printedTotalChf === "number" && ext.printedTotalChf > 0
      ? Math.round(ext.printedTotalChf)
      : undefined;
  const endpointValueChf = series.length > 0 ? Math.round(series[series.length - 1].valueChf) : undefined;
  let endpointMatchesTotal: boolean | undefined;

  if (printedTotalChf !== undefined && endpointValueChf !== undefined) {
    const diffRatio = Math.abs(endpointValueChf - printedTotalChf) / Math.max(1, printedTotalChf);
    endpointMatchesTotal = diffRatio <= ENDPOINT_TOTAL_TOLERANCE;
    if (endpointMatchesTotal) {
      checks.push(
        msg("vision.verifyEndpointOk", {
          endpoint: endpointValueChf,
          printed: printedTotalChf,
        }),
      );
    } else {
      warnings.push(
        msg("vision.warnEndpointMismatch", {
          endpoint: endpointValueChf,
          printed: printedTotalChf,
          diff: diffRatio,
        }),
      );
    }
  }

  const latestValueChf = printedTotalChf ?? endpointValueChf;

  // 4. Peak-to-trough drawdown >= 10% computed in TypeScript
  const maxDrawdown = computePeakToTroughDrawdown(series);
  const significantDrawdown =
    maxDrawdown && maxDrawdown.drawdownPct >= DRAWDOWN_THRESHOLD ? maxDrawdown : undefined;

  if (significantDrawdown) {
    warnings.push(
      msg("vision.warnDrawdown", {
        pct: significantDrawdown.drawdownPct,
        peak: significantDrawdown.peakChf,
        peakMonth: significantDrawdown.peakMonth,
        trough: significantDrawdown.troughChf,
        troughMonth: significantDrawdown.troughMonth,
      }),
    );
  } else if (series.length >= 2) {
    checks.push(msg("vision.verifyNoDrawdown"));
  }

  // Headline
  let headline: Msg;
  if (allocation && latestValueChf !== undefined && significantDrawdown) {
    headline = msg("vision.chartHeadlineFull", {
      value: latestValueChf,
      equities: allocation.equitiesPct / 100,
      risk: msg(`risk.${derivedRiskProfile ?? "balanced"}`),
      dd: significantDrawdown.drawdownPct,
    });
  } else if (allocation && latestValueChf !== undefined) {
    headline = msg("vision.chartHeadlineAllocValue", {
      value: latestValueChf,
      equities: allocation.equitiesPct / 100,
      risk: msg(`risk.${derivedRiskProfile ?? "balanced"}`),
    });
  } else if (allocation) {
    headline = msg("vision.chartHeadlineAllocOnly", {
      equities: allocation.equitiesPct / 100,
      bonds: allocation.bondsPct / 100,
      risk: msg(`risk.${derivedRiskProfile ?? "balanced"}`),
    });
  } else if (latestValueChf !== undefined && significantDrawdown) {
    headline = msg("vision.chartHeadlineValueDd", {
      value: latestValueChf,
      dd: significantDrawdown.drawdownPct,
    });
  } else {
    headline = msg("vision.chartHeadlineValueOnly", {
      value: latestValueChf ?? 0,
    });
  }

  return {
    pixelMeasurement: ext.pixelMeasurement,
    accountType: ext.accountType ?? "portfolio",
    provider: ext.provider,
    allocation,
    allocationSumPct,
    allocationValid,
    derivedRiskProfile,
    series,
    isMonotoneInTime,
    printedTotalChf,
    endpointValueChf,
    endpointMatchesTotal,
    latestValueChf,
    maxDrawdown,
    significantDrawdown,
    headline,
    checks,
    warnings,
  };
}

/**
 * Re-computes deterministic chart verification when the user edits the portfolio value or equity share in VisionReviewCard.
 */
export function reverifyChart(
  prev: ChartVerification,
  overrides: { latestValueChf?: number; equitiesPct?: number },
): ChartVerification {
  const latestValueChf =
    overrides.latestValueChf !== undefined && overrides.latestValueChf > 0
      ? Math.round(overrides.latestValueChf)
      : prev.latestValueChf;

  let allocation = prev.allocation;
  let derivedRiskProfile = prev.derivedRiskProfile;
  if (overrides.equitiesPct !== undefined && Number.isFinite(overrides.equitiesPct)) {
    const eq = Math.max(0, Math.min(100, round1(overrides.equitiesPct)));
    derivedRiskProfile = riskProfileFromEquitiesPct(eq);
    if (allocation) {
      allocation = { ...allocation, equitiesPct: eq };
    } else {
      allocation = { equitiesPct: eq, bondsPct: Math.max(0, 100 - eq), cashPct: 0, realEstatePct: 0, otherPct: 0 };
    }
  }

  let headline: Msg;
  if (allocation && latestValueChf !== undefined && prev.significantDrawdown) {
    headline = msg("vision.chartHeadlineFull", {
      value: latestValueChf,
      equities: allocation.equitiesPct / 100,
      risk: msg(`risk.${derivedRiskProfile ?? "balanced"}`),
      dd: prev.significantDrawdown.drawdownPct,
    });
  } else if (allocation && latestValueChf !== undefined) {
    headline = msg("vision.chartHeadlineAllocValue", {
      value: latestValueChf,
      equities: allocation.equitiesPct / 100,
      risk: msg(`risk.${derivedRiskProfile ?? "balanced"}`),
    });
  } else if (allocation) {
    headline = msg("vision.chartHeadlineAllocOnly", {
      equities: allocation.equitiesPct / 100,
      bonds: allocation.bondsPct / 100,
      risk: msg(`risk.${derivedRiskProfile ?? "balanced"}`),
    });
  } else if (latestValueChf !== undefined && prev.significantDrawdown) {
    headline = msg("vision.chartHeadlineValueDd", {
      value: latestValueChf,
      dd: prev.significantDrawdown.drawdownPct,
    });
  } else {
    headline = msg("vision.chartHeadlineValueOnly", {
      value: latestValueChf ?? 0,
    });
  }

  return {
    ...prev,
    pixelMeasurement: overrides.equitiesPct !== undefined ? undefined : prev.pixelMeasurement,
    checks: overrides.equitiesPct !== undefined ? prev.checks.filter(c => c.key !== "vision.pixelMeasured" && c.key !== "vision.pixelDisagreement") : prev.checks,
    latestValueChf,
    allocation,
    derivedRiskProfile,
    headline,
  };
}

/**
 * Clean minimal apply function for chart results:
 *   1. Derived equity share sets the risk profile.
 *   2. Latest value updates the portfolio balance.
 *   3. Detected ≥10% drawdown produces a behaviour insight.
 *
 * The coordinator can also pass the returned `ChartTwinPatch` directly into the accounts store.
 */
export function applyChartVisionResult(
  chart: ChartVerification,
  current: { scenario: Scenario; portfolioChf: number },
): { scenario: Scenario; portfolioChf: number; patch: ChartTwinPatch } {
  const riskProfile = chart.derivedRiskProfile;
  const equitiesPct = chart.allocation?.equitiesPct;
  const portfolioChf =
    chart.latestValueChf !== undefined && chart.latestValueChf > 0
      ? Math.round(chart.latestValueChf)
      : undefined;
  const drawdown = chart.significantDrawdown;

  const insight: BehaviorInsight | undefined = drawdown
    ? {
        id: "chart-drawdown",
        title: msg("vision.insightDrawdownTitle", { pct: drawdown.drawdownPct }),
        detail: msg("vision.insightDrawdownDetail", {
          peak: drawdown.peakChf,
          peakMonth: drawdown.peakMonth,
          trough: drawdown.troughChf,
          troughMonth: drawdown.troughMonth,
        }),
      }
    : undefined;

  const nextScenario: Scenario = riskProfile
    ? { ...current.scenario, riskProfile }
    : current.scenario;
  const nextPortfolioChf = portfolioChf ?? current.portfolioChf;

  let summary: Msg;
  if (portfolioChf !== undefined && riskProfile && equitiesPct !== undefined) {
    summary = msg("vision.summaryChartBoth", {
      value: portfolioChf,
      equities: equitiesPct / 100,
      risk: msg(`risk.${riskProfile}`),
    });
  } else if (portfolioChf !== undefined) {
    summary = msg("vision.summaryChartValue", {
      value: portfolioChf,
    });
  } else if (riskProfile && equitiesPct !== undefined) {
    summary = msg("vision.summaryChartAlloc", {
      equities: equitiesPct / 100,
      risk: msg(`risk.${riskProfile}`),
    });
  } else {
    summary = chart.headline;
  }

  return {
    scenario: nextScenario,
    portfolioChf: nextPortfolioChf,
    patch: {
      riskProfile,
      equitiesPct,
      portfolioChf,
      drawdown,
      insight,
      summary,
    },
  };
}

/** Applies the chart patch's portfolio balance to a base Profile (pure, 0 tokens). */
export function applyChartToProfile(profile: Profile, patch: ChartTwinPatch | null): Profile {
  if (!patch || patch.portfolioChf === undefined || patch.portfolioChf <= 0) return profile;
  return { ...profile, portfolio: patch.portfolioChf };
}

/** Appends a detected chart drawdown insight to the behavioural twin profile (pure, 0 tokens). */
export function withChartInsight(behavior: BehaviorProfile, patch: ChartTwinPatch | null): BehaviorProfile {
  if (!patch?.insight) return behavior;
  const filtered = behavior.insights.filter((i) => i.id !== patch.insight!.id);
  return {
    ...behavior,
    insights: [patch.insight, ...filtered],
  };
}

// ---------------------------------------------------------------------------
// Strict JSON schema validation for vision model chart output
// ---------------------------------------------------------------------------

const toNum = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v
      .replace(/['’\s]/g, "")
      .replace(/^(?:CHF|Fr\.?)/i, "")
      .replace(/%$/i, "")
      .replace(",", ".");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

export function validateChartExtraction(raw: unknown): ChartExtraction | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  let allocation: Partial<ChartAllocation> | undefined;
  if (obj.allocation && typeof obj.allocation === "object" && !Array.isArray(obj.allocation)) {
    const a = obj.allocation as Record<string, unknown>;
    const equitiesPct = toNum(a.equitiesPct ?? a.equities ?? a.stocks);
    const bondsPct = toNum(a.bondsPct ?? a.bonds);
    const cashPct = toNum(a.cashPct ?? a.cash);
    const realEstatePct = toNum(a.realEstatePct ?? a.realEstate ?? a.property);
    const otherPct = toNum(a.otherPct ?? a.other);
    const candidate: Partial<ChartAllocation> = {
      ...(equitiesPct !== undefined && equitiesPct >= 0 && equitiesPct <= 100 ? { equitiesPct } : {}),
      ...(bondsPct !== undefined && bondsPct >= 0 && bondsPct <= 100 ? { bondsPct } : {}),
      ...(cashPct !== undefined && cashPct >= 0 && cashPct <= 100 ? { cashPct } : {}),
      ...(realEstatePct !== undefined && realEstatePct >= 0 && realEstatePct <= 100 ? { realEstatePct } : {}),
      ...(otherPct !== undefined && otherPct >= 0 && otherPct <= 100 ? { otherPct } : {}),
    };
    if (Object.keys(candidate).length > 0) allocation = candidate;
  }

  let series: ChartSeriesPoint[] | undefined;
  if (Array.isArray(obj.series)) {
    const pts: ChartSeriesPoint[] = [];
    for (const item of obj.series.slice(0, 36)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const p = item as Record<string, unknown>;
      const month = typeof p.month === "string" ? p.month.trim() : "";
      const valueChf = toNum(p.valueChf ?? p.value ?? p.amount);
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && valueChf !== undefined && valueChf > 0 && valueChf <= 50_000_000) {
        pts.push({ month, valueChf: Math.round(valueChf) });
      }
    }
    if (pts.length >= 2) series = pts;
  }

  const printedTotalChf = toNum(obj.printedTotalChf ?? obj.totalChf ?? obj.amount);
  const validTotal =
    printedTotalChf !== undefined && printedTotalChf > 0 && printedTotalChf <= 50_000_000
      ? Math.round(printedTotalChf)
      : undefined;

  const legend = parseLegend(obj.legend);
  if (!legend && !allocation && !series && validTotal === undefined) return undefined;

  const accountType =
    obj.accountType === "pillar3a" || obj.accountType === "pension" || obj.accountType === "portfolio"
      ? obj.accountType
      : "portfolio";
  const provider =
    typeof obj.provider === "string" && obj.provider.trim() ? obj.provider.trim().slice(0, 60) : undefined;
  const label =
    typeof obj.label === "string" && obj.label.trim() ? obj.label.trim().slice(0, 60) : undefined;

  return {
    accountType,
    ...(legend ? {legend} : {}),
    ...(provider ? { provider } : {}),
    ...(validTotal !== undefined ? { printedTotalChf: validTotal } : {}),
    ...(allocation ? { allocation } : {}),
    ...(series ? { series } : {}),
    ...(label ? { label } : {}),
  };
}

/**
 * Recorded offline fixture parser for demo chart samples when no API key is set.
 * In the ledger, offline runs have `usage.mode = "offline"` and are excluded from savings.
 */
export function offlineChartFromOcr(ocrText: string, subtype?: "donut" | "line" | "both"): ChartExtraction {
  const lower = ocrText.toLowerCase();

  // 1. Donut with legend only (Helvetia Vorsorge 3a)
  if (subtype === "donut" || /helvetia\s+vorsorge|anlageaufteilung|strategie\s+wachstum/.test(lower)) {
    return {
      accountType: "pillar3a",
      provider: "Helvetia Vorsorge 3a",
      legend: OFFLINE_LEGEND,
      allocation: {
        equitiesPct: 65,
        bondsPct: 20,
        realEstatePct: 10,
        cashPct: 5,
        otherPct: 0,
      },
    };
  }

  // 2. Unlabeled portfolio line chart with >= 10% drawdown (AlpenBank Depotentwicklung)
  if (subtype === "line" || /alpenbank|depotentwicklung|96['’\s]?500/.test(lower)) {
    return {
      accountType: "portfolio",
      provider: "AlpenBank Depot",
      printedTotalChf: 96_500,
      series: [
        { month: "2026-01", valueChf: 98_000 },
        { month: "2026-02", valueChf: 102_000 },
        { month: "2026-03", valueChf: 108_000 },
        { month: "2026-04", valueChf: 99_500 },
        { month: "2026-05", valueChf: 91_000 },
        { month: "2026-06", valueChf: 88_500 },
        { month: "2026-07", valueChf: 90_500 },
        { month: "2026-08", valueChf: 92_000 },
        { month: "2026-09", valueChf: 93_500 },
        { month: "2026-10", valueChf: 95_000 },
        { month: "2026-11", valueChf: 96_500 },
      ],
    };
  }

  // 3. Banking-app screenshot with both donut allocation & unlabeled line chart (LemanInvest Mobile)
  return {
    accountType: "portfolio",
    provider: "LemanInvest",
    legend: OFFLINE_LEGEND,
    printedTotalChf: 114_000,
    allocation: {
      equitiesPct: 70,
      bondsPct: 18,
      realEstatePct: 7,
      cashPct: 5,
      otherPct: 0,
    },
    series: [
      { month: "2026-01", valueChf: 116_000 },
      { month: "2026-03", valueChf: 125_000 },
      { month: "2026-05", valueChf: 112_000 },
      { month: "2026-06", valueChf: 106_000 },
      { month: "2026-08", valueChf: 109_000 },
      { month: "2026-09", valueChf: 110_500 },
      { month: "2026-11", valueChf: 114_000 },
    ],
  };
}

export const OFFLINE_LEGEND: LegendEntry[] = [
  {assetClass:"equities",label:"Aktien",colorHex:"#2563eb"},
  {assetClass:"bonds",label:"Obligationen",colorHex:"#10b981"},
  {assetClass:"realEstate",label:"Immobilien",colorHex:"#f59e0b"},
  {assetClass:"cash",label:"Cash",colorHex:"#8b5cf6"},
];
