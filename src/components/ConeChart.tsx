"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimResult } from "@/lib/finance/types";
import { chf, chfShort } from "@/lib/format";

interface Props {
  real: SimResult;
  ideal: SimResult;
  goal: { target: number; age: number };
  eventAges: { age: number; label: string }[];
}

export function ConeChart({ real, ideal, goal, eventAges }: Props) {
  const data = real.bands.map((b, i) => ({
    age: b.age,
    year: b.year,
    range: [b.p10, b.p90] as [number, number],
    p10: b.p10,
    p90: b.p90,
    real: b.p50,
    ideal: ideal.bands[i]?.p50,
  }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-2">
        <span className="flex items-center gap-2">
          <span className="inline-block h-[10px] w-5 rounded-sm" style={{ background: "var(--series-1)", opacity: 0.18 }} />
          Real you · 10–90% range
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-[2px] w-5" style={{ background: "var(--series-1)" }} />
          Real you · median
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-0 w-5 border-t-2 border-dashed" style={{ borderColor: "var(--series-2)" }} />
          Disciplined you · median
        </span>
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
              tickFormatter={chfShort}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-3)", fontSize: 11 }}
              width={44}
            />
            <Tooltip content={<ConeTooltip />} cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }} />
            <Area
              dataKey="range"
              stroke="none"
              fill="var(--series-1)"
              fillOpacity={0.16}
              isAnimationActive={false}
              activeDot={false}
            />
            <ReferenceLine
              y={goal.target}
              stroke="var(--ink-2)"
              strokeDasharray="2 4"
              label={{ value: `Goal ${chfShort(goal.target)}`, position: "insideTopLeft", fill: "var(--ink-2)", fontSize: 11 }}
            />
            <ReferenceLine x={goal.age} stroke="var(--ink-3)" strokeDasharray="2 4" />
            {eventAges.map((e) => (
              <ReferenceLine key={e.label + e.age} x={e.age} stroke="var(--line)" strokeWidth={6} strokeOpacity={0.6} />
            ))}
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
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface TipProps {
  active?: boolean;
  payload?: { payload: { age: number; year: number; p10: number; p90: number; real: number; ideal: number } }[];
}

function ConeTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">
        Age {d.age} · {d.year}
      </div>
      <Row color="var(--series-1)" label="Real you (median)" value={chf(d.real)} />
      <Row color="var(--series-2)" label="Disciplined you" value={chf(d.ideal)} dashed />
      <div className="mt-1 text-ink-3">
        Bad year–good year: {chfShort(d.p10)} – {chfShort(d.p90)}
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
