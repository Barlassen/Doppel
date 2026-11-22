/**
 * Economic scenarios for Switzerland: named, documented alternatives to the baseline constants.
 *
 * A scenario is a sequence of phases. Each phase overrides part of the baseline regime for a number of years; after
 * the last phase the economy is back at the baseline. Scenarios are deterministic paths (no network, no regime
 * lottery), so two plans compared under the same scenario see the same economy, and the same scenario compared with
 * the baseline sees the same market draws (only their mean, volatility and the listed shocks change).
 *
 * What a scenario can change: inflation, nominal wage growth, equity / bond / property returns, cash and BVG
 * interest, the mortgage rate a home loan locks in (10-year fixed, reset every 10 years), a one-off equity shock
 * and the yearly risk of losing the job.
 *
 * Sources: docs/REAL_WORLD_FACTORS.md §1.1 and §2.2 A; every number is in `params.ts`.
 */
import type { Msg } from "@/lib/i18n/types";
import { BASELINE, REGIMES, TRANSMISSION, type Param, type ParamProvenance } from "./params";

/** One year of the economy. All rates are nominal, per year. */
export interface EconomyRegime {
  inflation: number;
  wageGrowth: number;
  equityMu: number;
  equitySigma: number;
  bondMu: number;
  bondSigma: number;
  cashRate: number;
  homeMu: number;
  homeSigma: number;
  pillar2Rate: number;
  /** Rate a mortgage taken out (or reset) in this year locks in. */
  mortgageRate: number;
  /** Probability per year of losing the job for `TRANSMISSION.jobLossSpellMonths` months (0 = only explicit events). */
  jobLossRisk: number;
}

export const BASELINE_REGIME: EconomyRegime = {
  inflation: BASELINE.inflation.value,
  wageGrowth: BASELINE.wageGrowth.value,
  equityMu: BASELINE.equityMu.value,
  equitySigma: BASELINE.equitySigma.value,
  bondMu: BASELINE.bondMu.value,
  bondSigma: BASELINE.bondSigma.value,
  cashRate: BASELINE.cashRate.value,
  homeMu: BASELINE.homeMu.value,
  homeSigma: BASELINE.homeSigma.value,
  pillar2Rate: BASELINE.pillar2Rate.value,
  mortgageRate: BASELINE.mortgageRate.value,
  jobLossRisk: 0,
};

/** Where one overridden value of a phase comes from. */
export interface EconomySource {
  field: keyof EconomyRegime | "equityShock";
  value: number;
  provenance: ParamProvenance;
  source: string;
  url?: string;
  estimate?: boolean;
}

export interface EconomyPhase {
  /** Length in years (whole years). */
  years: number;
  label: Msg;
  /** Baseline values this phase replaces. */
  regime: Partial<EconomyRegime>;
  /** One-month equity return applied in the first month of the phase, e.g. −0.3. */
  equityShock?: number;
  sources: EconomySource[];
}

export interface EconomyScenario {
  id: string;
  label: Msg;
  /** One sentence: what happens. */
  summary: Msg;
  phases: EconomyPhase[];
}

export const ECONOMY_IDS = ["baseline", "high_inflation", "recession", "low_rates", "climate_transition"] as const;
export type EconomyId = (typeof ECONOMY_IDS)[number];
export const isEconomyId = (v: unknown): v is EconomyId => typeof v === "string" && (ECONOMY_IDS as readonly string[]).includes(v);

type RegimeName = keyof typeof REGIMES;

const src = (field: EconomySource["field"], value: number, param: Param, provenance: ParamProvenance = param.provenance): EconomySource => ({
  field,
  value,
  provenance,
  source: param.source,
  ...(param.url ? { url: param.url } : {}),
  ...(param.estimate ? { estimate: true } : {}),
});

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * A sourced macro regime as baseline overrides. Taken from the regime: CPI, the 10-year mortgage rate, and through
 * the transmission rules cash and BVG interest. Derived so that a scenario only differs from the baseline by what
 * the regime says:
 *  - real wages: the regime's drift RELATIVE to the price-stability regime, on top of the baseline's real wage
 *    growth (the baseline stands for that regime; its real wage growth is 0%)
 *  - shares, bonds and property: the baseline's REAL return, so their nominal return moves with inflation. No
 *    regime-specific market return is assumed (the sources give none); shocks are listed separately.
 */
function regimePatch(name: RegimeName): { regime: Partial<EconomyRegime>; sources: EconomySource[] } {
  const r = REGIMES[name];
  const inflation = r.inflation.value;
  const shift = inflation - BASELINE.inflation.value;
  const realWage = BASELINE.wageGrowth.value - BASELINE.inflation.value + (r.realWage.value - REGIMES.normal.realWage.value);
  const wageGrowth = round6(inflation + realWage);
  const cashRate = Math.max(0, round6(r.policyRate.value - TRANSMISSION.cashBelowPolicy.value));
  const pillar2Rate = Math.max(BASELINE.pillar2Rate.value, round6(TRANSMISSION.pillar2ShareOfMortgage.value * r.mortgageRate.value));
  const equityMu = round6(BASELINE.equityMu.value + shift);
  const bondMu = round6(BASELINE.bondMu.value + shift);
  const homeMu = round6(BASELINE.homeMu.value + shift);
  const real = (field: EconomySource["field"], value: number): EconomySource => ({
    field,
    value,
    provenance: "derived",
    source: "Baseline real return kept: the nominal return moves with the regime's inflation",
  });
  return {
    regime: { inflation, wageGrowth, cashRate, pillar2Rate, mortgageRate: r.mortgageRate.value, equityMu, bondMu, homeMu },
    sources: [
      src("inflation", inflation, r.inflation),
      { ...src("wageGrowth", wageGrowth, r.realWage, "derived"), source: `${r.realWage.source}; applied relative to the price-stability regime (+0.6%) on the baseline's real wage growth` },
      src("cashRate", cashRate, TRANSMISSION.cashBelowPolicy, "derived"),
      src("pillar2Rate", pillar2Rate, TRANSMISSION.pillar2ShareOfMortgage, "derived"),
      src("mortgageRate", r.mortgageRate.value, r.mortgageRate),
      real("equityMu", equityMu),
      real("bondMu", bondMu),
      real("homeMu", homeMu),
    ],
  };
}

/** Expected length of a regime in years: 1 / (1 − yearly stay probability), rounded. */
export const regimeYears = (name: RegimeName) => Math.max(1, Math.round(1 / (1 - REGIMES[name].stayProb.value)));

/** Yearly job-loss probability implied by an unemployment rate above today's: excess rate × 12 / spell length. */
export function jobLossRiskFor(unemploymentRate: number): number {
  const excess = Math.max(0, unemploymentRate - BASELINE.unemploymentRate.value);
  return Math.round(((excess * 12) / TRANSMISSION.jobLossSpellMonths.value) * 1e6) / 1e6;
}

const high = regimePatch("high");
const low = regimePatch("low");
const recessionRisk = jobLossRiskFor(TRANSMISSION.recessionUnemploymentRate.value);

export const ECONOMIES: Readonly<Record<EconomyId, EconomyScenario>> = {
  baseline: {
    id: "baseline",
    label: { key: "economy.name.baseline" },
    summary: { key: "economy.summary.baseline" },
    phases: [],
  },
  high_inflation: {
    id: "high_inflation",
    label: { key: "economy.name.high_inflation" },
    summary: { key: "economy.summary.high_inflation", params: { years: regimeYears("high"), inflation: high.regime.inflation!, mortgage: high.regime.mortgageRate! } },
    phases: [{ years: regimeYears("high"), label: { key: "economy.phase.high" }, ...high }],
  },
  recession: {
    id: "recession",
    label: { key: "economy.name.recession" },
    summary: {
      key: "economy.summary.recession",
      params: { shock: -BASELINE.crashShock.value, risk: recessionRisk, riskYears: 2, years: regimeYears("low"), unemployment: TRANSMISSION.recessionUnemploymentRate.value },
    },
    phases: [
      {
        years: 2,
        label: { key: "economy.phase.recession" },
        regime: { ...low.regime, jobLossRisk: recessionRisk },
        equityShock: BASELINE.crashShock.value,
        sources: [
          ...low.sources,
          src("equityShock", BASELINE.crashShock.value, BASELINE.crashShock),
          src("jobLossRisk", recessionRisk, TRANSMISSION.recessionUnemploymentRate, "derived"),
        ],
      },
      { years: regimeYears("low") - 2, label: { key: "economy.phase.low" }, ...low },
    ],
  },
  low_rates: {
    id: "low_rates",
    label: { key: "economy.name.low_rates" },
    summary: { key: "economy.summary.low_rates", params: { years: regimeYears("low"), inflation: low.regime.inflation!, mortgage: low.regime.mortgageRate! } },
    phases: [{ years: regimeYears("low"), label: { key: "economy.phase.low" }, ...low }],
  },
  climate_transition: {
    id: "climate_transition",
    label: { key: "economy.name.climate_transition" },
    summary: { key: "economy.summary.climate_transition", params: { years: TRANSMISSION.climateYears.value, drag: -TRANSMISSION.climateEquityDrag.value } },
    phases: [
      {
        years: TRANSMISSION.climateYears.value,
        label: { key: "economy.phase.climate" },
        regime: { equityMu: Math.round((BASELINE.equityMu.value + TRANSMISSION.climateEquityDrag.value) * 1e6) / 1e6 },
        sources: [src("equityMu", Math.round((BASELINE.equityMu.value + TRANSMISSION.climateEquityDrag.value) * 1e6) / 1e6, TRANSMISSION.climateEquityDrag, "derived")],
      },
    ],
  },
};

/** The scenario for an id, a custom scenario as given, or the baseline. */
export function resolveEconomy(e: EconomyId | EconomyScenario | undefined | null): EconomyScenario {
  if (!e) return ECONOMIES.baseline;
  if (typeof e === "string") return ECONOMIES[e] ?? ECONOMIES.baseline;
  return e;
}

/** The regime of every simulated year (baseline after the last phase), plus the months with an equity shock. */
export function economyYears(e: EconomyScenario, years: number, base: EconomyRegime = BASELINE_REGIME): { regimes: EconomyRegime[]; shocks: Map<number, number>; phaseOf: (number | null)[] } {
  const regimes: EconomyRegime[] = [];
  const phaseOf: (number | null)[] = [];
  const shocks = new Map<number, number>();
  let year = 0;
  e.phases.forEach((ph, i) => {
    const n = Math.max(0, Math.round(ph.years));
    if (n > 0 && ph.equityShock !== undefined && Number.isFinite(ph.equityShock) && year < years) shocks.set(year * 12, Math.max(-0.95, Math.min(1, ph.equityShock)));
    for (let k = 0; k < n && year < years; k++, year++) {
      regimes.push({ ...base, ...clean(ph.regime) });
      phaseOf.push(i);
    }
  });
  for (; year < years; year++) {
    regimes.push(base);
    phaseOf.push(null);
  }
  return { regimes, shocks, phaseOf };
}

const LIMITS: Record<keyof EconomyRegime, readonly [number, number]> = {
  inflation: [-0.05, 0.25],
  wageGrowth: [-0.1, 0.25],
  equityMu: [-0.5, 0.5],
  equitySigma: [0, 1],
  bondMu: [-0.2, 0.3],
  bondSigma: [0, 0.5],
  cashRate: [-0.02, 0.2],
  homeMu: [-0.3, 0.3],
  homeSigma: [0, 0.5],
  pillar2Rate: [0, 0.2],
  mortgageRate: [0, 0.2],
  jobLossRisk: [0, 1],
};

/** Custom scenarios come from users: keep only finite values inside plausible bounds. */
function clean(patch: Partial<EconomyRegime>): Partial<EconomyRegime> {
  const out: Partial<EconomyRegime> = {};
  for (const key of Object.keys(LIMITS) as (keyof EconomyRegime)[]) {
    const v = patch[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[key] = Math.max(LIMITS[key][0], Math.min(LIMITS[key][1], v));
  }
  return out;
}

/** Dated rows for a UI: every baseline value and every value a scenario changes, with its source. */
export function economyTable(e: EconomyId | EconomyScenario = "baseline") {
  const scenario = resolveEconomy(e);
  return {
    id: scenario.id,
    label: scenario.label,
    summary: scenario.summary,
    baseline: (Object.keys(BASELINE) as (keyof typeof BASELINE)[]).map((id) => ({ id, ...BASELINE[id] })),
    phases: scenario.phases.map((ph, i) => ({
      index: i,
      label: ph.label,
      years: ph.years,
      fromYear: scenario.phases.slice(0, i).reduce((s, x) => s + x.years, 0),
      changes: ph.sources.map((s) => ({ ...s, baseline: s.field === "equityShock" ? 0 : BASELINE_REGIME[s.field] })),
    })),
  };
}
