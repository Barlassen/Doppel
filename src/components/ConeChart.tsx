"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimResult } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface Props {
  real: SimResult;
  ideal: SimResult;
  goal: { target: number; age: number };
  eventAges: { age: number; id: string }[];
  /** Pinned Plan A, simulated with the same seed — drawn as a ghost median + faint band. */
  planA?: SimResult | null;
  /** Shades the retirement phase from this age. */
  retirementAge?: number;
  /** Draw the target as a net-worth line (off when the goal measures cash, not net worth). Default true. */
  targetLine?: boolean;
}

export function ConeChart({ real, ideal, goal, eventAges, planA, retirementAge, targetLine = true }: Props) {
  const { t, fmt } = useI18n();
  const byAgeA = new Map(planA?.bands.map((b) => [b.age, b]) ?? []);
  const data = real.bands.map((b, i) => {
    const a = byAgeA.get(b.age);
    return {
      age: b.age,
      year: b.year,
      range: [b.p10, b.p90] as [number, number],
      p10: b.p10,
      p90: b.p90,
      real: b.p50,
      ideal: ideal.bands[i]?.p50,
      planA: a?.p50,
      rangeA: a ? ([a.p10, a.p90] as [number, number]) : undefined,
    };
  });
  const lastAge = data[data.length - 1]?.age ?? goal.age;
  // A plan whose shortfall is borrowed for decades (e.g. a permanent deficit) would squash the chart into a line:
  // cut the axis at −max(top, 50k) and say so below the chart.
  const top = Math.max(0, ...data.map((d) => Math.max(d.p90, d.ideal ?? 0, d.rangeA?.[1] ?? 0)), targetLine ? goal.target : 0);
  const bottom = Math.min(0, ...data.map((d) => Math.min(d.p10, d.ideal ?? 0, d.rangeA?.[0] ?? 0)));
  const floor = top > 0 && bottom < -Math.max(top, 50_000) ? -Math.max(top, 50_000) : null;
  const retire = retirementAge !== undefined && retirementAge < lastAge ? retirementAge : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-2">
        <span className="flex items-center gap-2">
          <span className="inline-block h-[10px] w-5 rounded-sm" style={{ background: "var(--series-1)", opacity: 0.18 }} />
          {t("chart.legendRange")}
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-[2px] w-5" style={{ background: "var(--series-1)" }} />
          {t("chart.legendReal")}
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-0 w-5 border-t-2 border-dashed" style={{ borderColor: "var(--series-2)" }} />
          {t("chart.legendIdeal")}
        </span>
        {planA && (
          <span className="flex items-center gap-2">
            <span className="inline-block h-0 w-5 border-t-2 border-dotted" style={{ borderColor: "var(--ink-3)" }} />
            {t("chart.legendPlanA")}
          </span>
        )}
        {retire !== undefined && (
          <span className="flex items-center gap-2">
            <span className="inline-block h-[10px] w-5 rounded-sm" style={{ background: "var(--ink-3)", opacity: 0.15 }} />
            {t("chart.legendRetirement")}
          </span>
        )}
      </div>
      <div className="h-[300px] w-full sm:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
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
              tickFormatter={fmt.chfShort}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-3)", fontSize: 11 }}
              width={44}
              {...(floor !== null ? { domain: [floor, "auto"] as [number, string], allowDataOverflow: true } : {})}
            />
            <Tooltip content={<ConeTooltip />} cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }} />
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
            {planA && (
              <Area
                dataKey="rangeA"
                name={t("chart.legendPlanA")}
                stroke="none"
                fill="var(--ink-3)"
                fillOpacity={0.08}
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            <Area
              dataKey="range"
              name={t("chart.legendRange")}
              stroke="none"
              fill="var(--series-1)"
              fillOpacity={0.16}
              isAnimationActive={false}
              activeDot={false}
            />
            {targetLine && (
              <ReferenceLine
                y={goal.target}
                stroke="var(--ink-2)"
                strokeDasharray="2 4"
                label={{ value: t("chart.goal", { target: goal.target }), position: "insideTopLeft", fill: "var(--ink-2)", fontSize: 11 }}
              />
            )}
            <ReferenceLine x={goal.age} stroke="var(--ink-3)" strokeDasharray="2 4" />
            {eventAges.map((e) => (
              <ReferenceLine key={e.id} x={e.age} stroke="var(--line)" strokeWidth={6} strokeOpacity={0.6} />
            ))}
            {planA && (
              <Line
                dataKey="planA"
                name={t("chart.legendPlanA")}
                stroke="var(--ink-3)"
                strokeWidth={2}
                strokeDasharray="1 4"
                strokeLinecap="round"
                dot={false}
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            <Line
              dataKey="ideal"
              name={t("chart.legendIdeal")}
              stroke="var(--series-2)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            />
            <Line
              dataKey="real"
              name={t("chart.legendReal")}
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {floor !== null && <p className="mt-2 text-xs text-ink-2" data-testid="chart-clipped">{t("ubs.chartClipped", { floor })}</p>}
    </div>
  );
}

interface TipProps {
  active?: boolean;
  payload?: { payload: { age: number; year: number; p10: number; p90: number; real: number; ideal: number; planA?: number } }[];
}

function ConeTooltip({ active, payload }: TipProps) {
  const { t, fmt } = useI18n();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">
        {t("chart.tipAge", { age: d.age, year: d.year })}
      </div>
      <Row color="var(--series-1)" label={t("chart.tipReal")} value={fmt.chf(d.real)} />
      <Row color="var(--series-2)" label={t("chart.tipIdeal")} value={fmt.chf(d.ideal)} dashed />
      {d.planA !== undefined && <Row color="var(--ink-3)" label={t("chart.tipPlanA")} value={fmt.chf(d.planA)} dashed />}
      <div className="mt-1 text-ink-3">
        {t("chart.tipRange", { p10: d.p10, p90: d.p90 })}
      </div>
    </div>
  );
}

function Row({ color, label, value, dashed }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-ink-2">
        <span className={`inline-block w-3 ${dashed ? "border-t-2 border-dashed" : "h-[2px]"}`} style={dashed ? { borderColor: color } : { background: color }} />
        {label}
      </span>
      <span className="num font-medium text-ink">{value}</span>
    </div>
  );
}
