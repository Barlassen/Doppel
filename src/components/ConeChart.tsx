"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CashPoint } from "@/lib/finance/outlook";
import type { SimResult, YearBand } from "@/lib/finance/types";
import { MINUS } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Text } from "@/lib/i18n/types";
import { ON_TRACK, POSSIBLE } from "./ui";

/** A dated point on the chart: a life event or one of the engine's outlook markers (birth, daycare, car bought, …). */
export interface ChartMarker {
  id: string;
  age: number;
  icon: string;
  label: Text;
  /** Lower = kept first when there are more markers than the chart can show. */
  rank?: number;
}

interface Props {
  real: SimResult;
  ideal: SimResult;
  goal: { target: number; age: number; label: Text };
  /** Dated markers above the plot (the outlook's markers, or the plan's events while it is computed). */
  markers: ChartMarker[];
  /** The plan without the changes (or the pinned Plan A), simulated with the same seed: the "before" line. */
  before?: SimResult | null;
  /** What the before line stands for, e.g. "Before your changes" or "Plan A: pinned plan". */
  beforeLabel?: string;
  /** Lowest month-end bank cash of the outlook (median future and weakest tenth): the reading names the month. */
  cashLow?: { median: CashPoint; p10: CashPoint };
  /** Shades the retirement phase from this age. */
  retirementAge?: number;
  /** Draw the target as a net-worth line and dot (off when the goal measures cash, not net worth). Default true. */
  targetLine?: boolean;
  /** Net worth at month 0, for the first sentence of the reading. */
  netWorthToday: number;
  /** Extension point: a line under the reading, e.g. the economic scenario the futures were drawn from. */
  footnote?: React.ReactNode;
}

/** The reading looks this many years ahead before it jumps to the goal date. */
const READ_AHEAD_YEARS = 5;
/** Marker rows above the plot. */
const MARKER_ROWS = 3;
/** At most this many markers are drawn (by `rank`, then by date): more would cover each other. */
const MARKER_MAX = 12;
const MARKER_ROW_PX = 17;
/** The default view ends this share of the way-to-the-goal after the goal (at least MIN years): the decision window. */
const GOAL_VIEW_PAD = 0.25;
const GOAL_VIEW_MIN_YEARS = 3;

/** "Nice" axis ticks (steps of 1, 2, 2.5 or 5 × 10ⁿ) so every label on the axis has the same precision. */
function niceTicks(min: number, max: number): { ticks: number[]; step: number } {
  const span = Math.max(1, max - min);
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v < max + step; v += step) ticks.push(Math.round(v));
  return { ticks, step };
}

export function ConeChart({ real, ideal, goal, markers: given, before, beforeLabel, cashLow, retirementAge, targetLine = true, netWorthToday, footnote }: Props) {
  const { t, tm, fmt } = useI18n();
  const [wholeLife, setWholeLife] = useState(false);
  const byAgeA = new Map(before?.bands.map((b) => [b.age, b]) ?? []);
  const all = real.bands.map((b, i) => {
    const a = byAgeA.get(b.age);
    return {
      age: b.age,
      year: b.year,
      range: [b.p10, b.p90] as [number, number],
      p10: b.p10,
      p90: b.p90,
      real: b.p50,
      ideal: ideal.bands[i]?.p50,
      before: a?.p50,
      rangeBefore: a ? ([a.p10, a.p90] as [number, number]) : undefined,
    };
  });
  const firstAge = all[0]?.age ?? goal.age;
  const endAge = all[all.length - 1]?.age ?? goal.age;
  // Default view: from today to a little past the goal date and the last life event, so the years the decisions are
  // about fill the chart. The whole life (to the end age) is one click away.
  const toGoal = goal.age - firstAge;
  const focusEnd = goal.age + Math.max(GOAL_VIEW_MIN_YEARS, Math.round(toGoal * GOAL_VIEW_PAD));
  const canFocus = toGoal >= GOAL_VIEW_MIN_YEARS && focusEnd < endAge - GOAL_VIEW_MIN_YEARS;
  const data = canFocus && !wholeLife ? all.filter((d) => d.age <= focusEnd) : all;
  const lastAge = data[data.length - 1]?.age ?? goal.age;
  // A plan whose shortfall is borrowed for decades (e.g. a permanent deficit) would squash the chart into a line:
  // cut the axis at −max(top, 50k) and say so below the chart.
  const top = Math.max(0, ...data.map((d) => Math.max(d.p90, d.ideal ?? 0, d.rangeBefore?.[1] ?? 0)), targetLine ? goal.target : 0);
  const bottom = Math.min(0, ...data.map((d) => Math.min(d.p10, d.ideal ?? 0, d.rangeBefore?.[0] ?? 0)));
  const floor = top > 0 && bottom < -Math.max(top, 50_000) ? -Math.max(top, 50_000) : null;
  const retire = retirementAge !== undefined && retirementAge < lastAge && retirementAge > firstAge ? retirementAge : undefined;
  const { ticks, step } = niceTicks(floor ?? bottom, top);
  const millionDigits = step % 1e6 === 0 ? 0 : step % 1e5 === 0 ? 1 : 2;
  const tick = (v: number) => {
    const a = Math.abs(v);
    return a >= 1e6 ? `${v < 0 ? MINUS : ""}${fmt.num(a / 1e6, millionDigits)}M` : fmt.chfShort(v);
  };

  // Markers above the plot: the goal date and every life event, in rows so close ones do not overlap.
  const goalInRange = goal.age >= firstAge && goal.age <= lastAge;
  // Placement: the goal flag and the first marker of each event carry a label and need a fifth of the axis to
  // themselves; the others are icons (label on hover) and need a twentieth. What finds no free row is left out:
  // every marker is also in the decisions list and in the outlook.
  const span = Math.max(1, lastAge - firstAge);
  const candidates = [
    ...(goalInRange ? [{ id: "goal", age: goal.age, icon: "⚑", label: t("ux.chart.goalMark"), rank: -1 }] : []),
    ...given.filter((m) => m.age >= firstAge && m.age <= lastAge).map((m) => ({ id: m.id, age: m.age, icon: m.icon, label: tm(m.label), rank: m.rank ?? 1 })),
  ].sort((a, b) => a.rank - b.rank || a.age - b.age).slice(0, MARKER_MAX);
  const taken: { from: number; to: number }[][] = Array.from({ length: MARKER_ROWS }, () => []);
  const placed: { id: string; age: number; icon: string; label: string; row: number; named: boolean; flip: boolean }[] = [];
  for (const m of candidates) {
    const flip = m.age - firstAge > span * 0.7;
    const wide = span / 5;
    const narrow = span / 20;
    const fits = (row: number, from: number, to: number) => taken[row].every((x) => to <= x.from || from >= x.to);
    const tryPlace = (named: boolean) => {
      const from = named && flip ? m.age - wide : m.age - narrow / 2;
      const to = named && !flip ? m.age + wide : m.age + narrow / 2;
      const row = taken.findIndex((_, r) => fits(r, from, to));
      if (row < 0) return false;
      taken[row].push({ from, to });
      placed.push({ id: m.id, age: m.age, icon: m.icon, label: m.label, row, named, flip });
      return true;
    };
    if (!(m.rank <= 0 && tryPlace(true))) tryPlace(false);
  }
  const rowEnd = taken.filter((r) => r.length > 0);
  const rows = Math.max(1, rowEnd.length);

  const reading = readChart({ real, before, goal, targetLine, netWorthToday });
  // " (140k–181k)": left out when the band has no width at this precision (e.g. no investments at all).
  const range = (b: YearBand) => (fmt.chfShort(b.p10) === fmt.chfShort(b.p90) ? "" : ` (${fmt.chfShort(b.p10)}–${fmt.chfShort(b.p90)})`);
  const sinks = reading.underwaterAge !== null;
  const lines = [
    // "Today CHF 10’000 → in 5 years about CHF 159k (140k–181k) → at 40 about CHF 593k (459k–809k)."
    [
      t("ux.chart.readNow", { now: netWorthToday }),
      reading.ahead ? t("ux.chart.readAhead", { years: reading.ahead.years, mid: reading.ahead.band.p50, range: range(reading.ahead.band) }) : "",
      reading.atGoal ? t("ux.chart.readGoal", { age: reading.atGoal.age, year: reading.atGoal.year, mid: reading.atGoal.p50, range: range(reading.atGoal) }) : "",
    ].filter(Boolean).join(" → ") + ".",
    [
      t(`ux.chart.status.${reading.status}`, { odds: real.successProb }),
      reading.gap > 0 ? t("ux.chart.readGap", { gap: reading.gap }) : "",
    ].filter(Boolean).join(" "),
    cashLow
      ? // The outlook's lowest month-end cash, with its month; the weakest tenth is added when it goes below zero.
        [
          t(cashLow.median.amount < 0 ? "ux.chart.readCashOut" : "ux.chart.readCashLow", { amount: cashLow.median.amount, when: cashLow.median.ym, age: cashLow.median.age }),
          cashLow.median.amount >= 0 && cashLow.p10.amount < 0 ? t("ux.chart.readCashWeak", { when: cashLow.p10.ym }) : "",
        ].filter(Boolean).join(" ")
      : [
          // While the outlook is computed: "no cash crunch" is only said when the weakest futures stay above zero until the goal date.
          real.crunchProb > 0 ? t("ux.chart.readCrunch", { p: real.crunchProb }) : sinks && reading.underwaterAge! <= goal.age ? "" : t("ux.chart.readNoCrunch"),
          sinks ? t("ux.chart.readUnderwater", { age: reading.underwaterAge! }) : "",
        ].filter(Boolean).join(" "),
    ...(before && reading.beforeAtGoal
      ? [t("ux.chart.readBefore", { label: beforeLabel ?? t("plan.pinned"), before: before.successProb, after: real.successProb, beforeMid: reading.beforeAtGoal.p50, afterMid: reading.atGoal?.p50 ?? real.medianAtGoal })]
      : before
        ? [t("ux.chart.readBeforeOdds", { label: beforeLabel ?? t("plan.pinned"), before: before.successProb, after: real.successProb })]
        : []),
  ];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-2">
        <span className="flex items-center gap-2">
          <span className="inline-block h-[2px] w-5" style={{ background: "var(--series-1)" }} />
          {t("ux.chart.legendMedian")}
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-[10px] w-5 rounded-sm" style={{ background: "var(--series-1)", opacity: 0.18 }} />
          {t("ux.chart.legendBand")}
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-0 w-5 border-t-2 border-dashed" style={{ borderColor: "var(--series-2)" }} />
          {t("ux.chart.legendIdeal")}
        </span>
        {before && (
          <span className="flex min-w-0 items-center gap-2" data-testid="chart-before">
            <span className="inline-block h-0 w-5 shrink-0 border-t-2 border-dotted" style={{ borderColor: "var(--ink-2)" }} />
            <span className="min-w-0 break-words">{beforeLabel ?? t("plan.pinned")}</span>
          </span>
        )}
        {retire !== undefined && (
          <span className="flex items-center gap-2">
            <span className="inline-block h-[10px] w-5 rounded-sm" style={{ background: "var(--ink-3)", opacity: 0.15 }} />
            {t("chart.legendRetirement")}
          </span>
        )}
      </div>
      <div className="mb-1 flex flex-wrap items-end justify-end gap-x-3 gap-y-1.5">
        <span className="sr-only">{t("ux.chart.axisWorth")}</span>
        {canFocus && (
          <span className="flex rounded-full border border-line p-0.5 text-[11px]" role="group" aria-label={t("ux.chart.viewAria")}>
            {([false, true] as const).map((whole) => (
              <button
                key={String(whole)}
                type="button"
                aria-pressed={wholeLife === whole}
                onClick={() => setWholeLife(whole)}
                className={`min-h-6 rounded-full px-2.5 font-medium ${wholeLife === whole ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
              >
                {whole ? t("ux.chart.viewLife", { age: endAge }) : t("ux.chart.viewGoal")}
              </button>
            ))}
          </span>
        )}
      </div>
      <div className="w-full" style={{ height: 300 + rows * MARKER_ROW_PX }} role="img" aria-label={`${t("chart.title")}. ${t("ux.chart.axisWorth")}. ${lines.join(" ")}`} data-testid="cone-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6 + rows * MARKER_ROW_PX, right: 12, bottom: 4, left: 0 }} accessibilityLayer={false}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="age"
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              tick={{ fill: "var(--ink-3)", fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={tick}
              ticks={ticks}
              domain={[floor ?? ticks[0], ticks[ticks.length - 1]]}
              allowDataOverflow={floor !== null}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-3)", fontSize: 11 }}
              width={46}
            />
            <Tooltip content={<ConeTooltip hasBefore={!!before} />} cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }} wrapperStyle={{ maxWidth: "100%" }} />
            {retire !== undefined && (
              <ReferenceArea
                x1={retire}
                x2={lastAge}
                fill="var(--ink-3)"
                fillOpacity={0.08}
                stroke="none"
                label={{ value: t("chart.retiredAt", { age: retire }), position: "insideTopRight", fill: "var(--ink-3)", fontSize: 11 }}
              />
            )}
            {before && (
              <Area dataKey="rangeBefore" stroke="none" fill="var(--ink-3)" fillOpacity={0.08} isAnimationActive={false} activeDot={false} />
            )}
            <Area dataKey="range" stroke="none" fill="var(--series-1)" fillOpacity={0.16} isAnimationActive={false} activeDot={false} />
            {targetLine && <ReferenceLine y={goal.target} stroke="var(--ink-2)" strokeDasharray="2 4" />}
            {placed.map((m) => (
              <ReferenceLine
                key={m.id}
                x={m.age}
                stroke={m.id === "goal" ? "var(--accent)" : "var(--ink-3)"}
                strokeDasharray="2 4"
                label={<Marker icon={m.icon} text={m.label} named={m.named} lift={(rows - m.row) * MARKER_ROW_PX - 5} flip={m.flip} accent={m.id === "goal"} />}
              />
            ))}
            {before && (
              <Line dataKey="before" stroke="var(--ink-2)" strokeWidth={2} strokeDasharray="1 5" strokeLinecap="round" dot={false} isAnimationActive={false} activeDot={false} />
            )}
            <Line
              dataKey="ideal"
              stroke="var(--series-2)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            />
            <Line
              dataKey="real"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            />
            {targetLine && goalInRange && (
              <ReferenceDot
                x={goal.age}
                y={goal.target}
                r={5}
                fill="var(--accent)"
                stroke="var(--surface)"
                strokeWidth={2}
                label={<GoalLabel text={t("ux.chart.goalAt", { target: goal.target, age: goal.age })} flip={goal.age - firstAge > (lastAge - firstAge) * 0.55} />}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center text-[11px] text-ink-3">{t("ux.chart.axisAge")}</div>

      {/* Two lines on the surface (the path and the lowest cash); the rest of the reading stays for screen readers. */}
      <ul className="mt-3 space-y-1 text-sm text-ink-2" data-testid="chart-reading">
        {lines.map((line, i) => (
          <li key={i} className={i === 0 || i === 2 ? "" : "sr-only"}>{line}</li>
        ))}
      </ul>
      {footnote && <div className="mt-2 text-xs text-ink-2">{footnote}</div>}
      {floor !== null && <p className="mt-2 text-xs text-ink-2" data-testid="chart-clipped">{t("ubs.chartClipped", { floor })}</p>}
    </div>
  );
}

/**
 * The numbers behind the plain-language reading. Everything comes from the simulation result: nothing is fixed
 * here except how far ahead the first sentence looks.
 */
export function readChart({ real, before, goal, targetLine, netWorthToday }: Pick<Props, "real" | "before" | "goal" | "targetLine" | "netWorthToday">) {
  const bands = real.bands;
  const atGoal: YearBand | undefined = bands.find((b) => b.age === goal.age);
  const aheadBand = bands[READ_AHEAD_YEARS];
  const ahead = aheadBand && (!atGoal || aheadBand.age < atGoal.age) ? { years: aheadBand.age - bands[0].age, band: aheadBand } : null;
  const status: "on" | "possible" | "off" = real.successProb >= ON_TRACK ? "on" : real.successProb >= POSSIBLE ? "possible" : "off";
  // The shortfall is only meaningful when the chart's quantity (net worth) is what the goal measures.
  const gap = targetLine !== false && status !== "on" && atGoal ? Math.max(0, goal.target - atGoal.p50) : 0;
  // First age at which the weakest tenth of futures is below zero (not counting a start that is already negative).
  const underwater = netWorthToday >= 0 ? bands.find((b) => b.p10 < 0) : undefined;
  const beforeAtGoal = before?.bands.find((b) => b.age === goal.age);
  return { atGoal: targetLine === false ? undefined : atGoal, ahead, status, gap, underwaterAge: underwater ? underwater.age : null, beforeAtGoal };
}

/** Icon (and, from the `sm` breakpoint, its label) in the margin above the plot, on the event's vertical line. */
function Marker({ viewBox, icon, text, named, lift, flip, accent }: { viewBox?: { x?: number; y?: number }; icon: string; text: string; named: boolean; lift: number; flip: boolean; accent?: boolean }) {
  const x = viewBox?.x ?? 0;
  const y = (viewBox?.y ?? 0) - lift;
  const short = text.length > 22 ? `${text.slice(0, 21)}…` : text;
  return (
    <g>
      <title>{text}</title>
      <text x={x} y={y} textAnchor="middle" fontSize={12} fill={accent ? "var(--accent)" : "var(--ink)"}>
        {icon}
      </text>
      {named && (
        <text x={flip ? x - 10 : x + 10} y={y} textAnchor={flip ? "end" : "start"} fontSize={11} fill={accent ? "var(--accent)" : "var(--ink-2)"} className="hidden sm:inline">
          {short}
        </text>
      )}
    </g>
  );
}

function GoalLabel({ viewBox, text, flip }: { viewBox?: { x?: number; y?: number; width?: number; height?: number }; text: string; flip: boolean }) {
  const cx = (viewBox?.x ?? 0) + (viewBox?.width ?? 0) / 2;
  const cy = (viewBox?.y ?? 0) + (viewBox?.height ?? 0) / 2;
  return (
    <text
      x={flip ? cx - 9 : cx + 9}
      y={cy - 8}
      textAnchor={flip ? "end" : "start"}
      fontSize={11}
      fontWeight={600}
      fill="var(--ink)"
      stroke="var(--surface)"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {text}
    </text>
  );
}

interface TipProps {
  active?: boolean;
  hasBefore?: boolean;
  payload?: { payload: { age: number; year: number; p10: number; p90: number; real: number; ideal: number; before?: number } }[];
}

function ConeTooltip({ active, payload, hasBefore }: TipProps) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  // Short amounts ("CHF 119k"): the tooltip has to fit a 250 px wide chart on a phone.
  const short = (v: number) => t("common.deltaChf", { sign: "", amount: v });
  return (
    <div className="card max-w-[11.5rem] px-2.5 py-2 text-xs shadow-lg sm:max-w-[15rem] sm:px-3">
      <div className="mb-1 font-semibold text-ink">
        {t("chart.tipAge", { age: d.age, year: d.year })}
      </div>
      <Row color="var(--series-1)" label={t("ux.chart.tipMedian")} value={short(d.real)} />
      <Row color="var(--series-2)" label={t("ux.chart.legendIdeal")} value={short(d.ideal)} dashed />
      {hasBefore && d.before !== undefined && <Row color="var(--ink-2)" label={t("chart.tipPlanA")} value={short(d.before)} dashed />}
      <div className="mt-1 text-ink-3">
        {t("chart.tipRange", { p10: d.p10, p90: d.p90 })}
      </div>
    </div>
  );
}

function Row({ color, label, value, dashed }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2 text-ink-2">
        <span className={`inline-block w-3 shrink-0 ${dashed ? "border-t-2 border-dashed" : "h-[2px]"}`} style={dashed ? { borderColor: color } : { background: color }} />
        {label}
      </span>
      <span className="num shrink-0 font-medium whitespace-nowrap text-ink">{value}</span>
    </div>
  );
}
