"use client";

import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DonutSlice } from "@/lib/game/engine";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/types";

/** Channel → categorical slot (fixed order, never cycled). Tokens in globals.css (`--ch-1` … `--ch-6`). */
export const CHANNELS = ["cashflow", "liquidity", "invested", "property", "pension", "debt"] as const;
export const channelColor = (ch: string) => `var(--ch-${CHANNELS.indexOf(ch as (typeof CHANNELS)[number]) + 1})`;

/**
 * Impact donut: where a move's effect lands, against holding. Outer ring = gains, inner ring = losses, both by
 * channel; the centre shows the change in goal odds. A 2px surface gap separates slices.
 */
export function ImpactDonut({ slices, title }: { slices: DonutSlice[]; title: string }) {
  const { t, fmt } = useI18n();
  const money = slices.filter((s) => s.channel !== "goal");
  const goal = slices.find((s) => s.channel === "goal")?.value ?? 0;
  const gains = money.filter((s) => s.value > 0.5).map((s) => ({ ...s, abs: s.value }));
  const losses = money.filter((s) => s.value < -0.5).map((s) => ({ ...s, abs: -s.value }));
  const empty = !gains.length && !losses.length;
  const name = (ch: string) => t(`play.channel.${ch}` as MessageKey);
  return (
    <figure className="flex min-w-0 flex-col items-center">
      <figcaption className="mb-1 text-center text-xs font-medium text-ink-2">{title}</figcaption>
      <div className="relative aspect-square w-full max-w-[170px]" role="img" aria-label={`${title}: ${money.filter((s) => Math.abs(s.value) > 0.5).map((s) => `${name(s.channel)} ${fmt.chfSigned(s.value)}`).join(", ") || t("play.review.donutEmpty")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={empty ? [{ abs: 1 }] : gains} dataKey="abs" nameKey="channel" innerRadius="70%" outerRadius="96%" paddingAngle={gains.length > 1 ? 2 : 0} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
              {(empty ? [{ channel: "none" }] : gains).map((s) => (
                <Cell key={s.channel} fill={empty ? "var(--surface-2)" : channelColor(s.channel)} />
              ))}
            </Pie>
            {losses.length > 0 && (
              <Pie data={losses} dataKey="abs" nameKey="channel" innerRadius="46%" outerRadius="64%" paddingAngle={losses.length > 1 ? 2 : 0} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
                {losses.map((s) => (
                  <Cell key={s.channel} fill={channelColor(s.channel)} fillOpacity={0.75} />
                ))}
              </Pie>
            )}
            {!empty && (
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as DonutSlice;
                  return (
                    <div className="card px-2.5 py-1.5 text-xs shadow-lg">
                      <span className="text-ink-2">{name(d.channel)}</span> <span className="num font-medium text-ink">{fmt.chfSigned(d.value)}</span>
                    </div>
                  );
                }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="num text-sm font-semibold text-ink">{fmt.signed(Math.round(goal * 1000) / 10)}</div>
            <div className="text-[10px] leading-tight text-ink-3">{t("play.review.donutGoal")}</div>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Legend + table view of the two donuts (identity is never colour alone). */
export function DonutTable({ you, best, showBest }: { you: DonutSlice[]; best: DonutSlice[]; showBest: boolean }) {
  const { t, fmt } = useI18n();
  const val = (xs: DonutSlice[], ch: string) => xs.find((s) => s.channel === ch)?.value ?? 0;
  const cell = (v: number, ch: string) => (ch === "goal" ? fmt.signed(Math.round(v * 1000) / 10) : Math.abs(v) < 0.5 ? "—" : fmt.chfSigned(v));
  return (
    <table className="mt-3 w-full text-xs">
      <thead>
        <tr className="text-ink-3">
          <th className="py-1 text-left font-medium" scope="col"><span className="sr-only">{t("play.review.donutTitle")}</span></th>
          <th className="py-1 text-right font-medium" scope="col">{t("play.review.donutYou")}</th>
          {showBest && <th className="py-1 text-right font-medium" scope="col">{t("play.review.donutBest")}</th>}
        </tr>
      </thead>
      <tbody>
        {[...CHANNELS, "goal" as const].map((ch) => (
          <tr key={ch} className="border-t border-line">
            <th scope="row" className="py-1 text-left font-normal text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ch === "goal" ? "transparent" : channelColor(ch), border: ch === "goal" ? "1px solid var(--ink-3)" : undefined }} />
                {t(`play.channel.${ch}` as MessageKey)}
              </span>
            </th>
            <td className="num py-1 text-right text-ink">{cell(val(you, ch), ch)}</td>
            {showBest && <td className="num py-1 text-right text-ink">{cell(val(best, ch), ch)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Evaluation bar: E of the engine's line and of the player's line, 0–100 points. */
export function EvalBars({ engine, you }: { engine: number | null; you: number | null }) {
  const { t } = useI18n();
  const row = (label: string, e: number | null, color: string, marker: string) => (
    <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(2rem,1fr)_auto] items-center gap-2">
      <span className="flex items-center gap-1.5 truncate text-xs text-ink-2">
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
        {label}
      </span>
      <div className="relative h-3 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label={label} aria-valuemin={-10} aria-valuemax={100} aria-valuenow={e === null ? undefined : Math.round(e * 100)}>
        {e !== null && <div className="absolute inset-y-0 left-0 rounded-full" data-marker={marker} style={{ width: `${Math.max(2, Math.min(100, e * 100))}%`, background: color }} />}
      </div>
      <span className="num text-right text-sm font-semibold whitespace-nowrap text-ink">{e === null ? "—" : t("play.evalBar.points", { e: e * 100 })}</span>
    </div>
  );
  return (
    <div className="space-y-2">
      {row(t("play.evalBar.engine"), engine, "var(--series-2)", "engine")}
      {row(t("play.evalBar.you"), you, "var(--series-1)", "you")}
    </div>
  );
}

/** End-of-game chart: E of the move played against E of the engine's best, per year. */
export function LinesChart({ data }: { data: { year: number; you: number; engine: number }[] }) {
  const { t, fmt } = useI18n();
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="flex items-center gap-2"><span className="inline-block h-[2px] w-5" style={{ background: "var(--series-1)" }} />{t("play.end.chartYou")}</span>
        <span className="flex items-center gap-2"><span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: "var(--series-2)" }} />{t("play.end.chartEngine")}</span>
      </div>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: "var(--line)" }} tick={{ fill: "var(--ink-3)", fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--ink-3)", fontSize: 11 }} width={32} domain={["auto", "auto"]} tickFormatter={(v: number) => fmt.num(v, 0)} />
            <Tooltip
              cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as { year: number; you: number; engine: number };
                return (
                  <div className="card px-3 py-2 text-xs shadow-lg">
                    <div className="mb-1 font-semibold text-ink">{t("play.end.chartAxis")} {d.year}</div>
                    <div className="flex justify-between gap-4 text-ink-2">{t("play.end.chartYou")} <span className="num font-medium text-ink">{fmt.num(d.you, 1)}</span></div>
                    <div className="flex justify-between gap-4 text-ink-2">{t("play.end.chartEngine")} <span className="num font-medium text-ink">{fmt.num(d.engine, 1)}</span></div>
                  </div>
                );
              }}
            />
            <Line dataKey="engine" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} />
            <Line dataKey="you" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: "var(--series-1)" }} isAnimationActive={false} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
