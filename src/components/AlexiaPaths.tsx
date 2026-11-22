"use client";

import { useEffect, useMemo, useState } from "react";
import { analyzeBehavior } from "@/lib/finance/behavioralEngine";
import { simulate } from "@/lib/finance/monteCarlo";
import { effectiveProfile, simInputFor } from "@/lib/finance/scenario";
import type { Profile, Scenario, SimResult } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {
  ALEXIA_PATH_IDS,
  alexiaLedger,
  alexiaPaths,
  applyPath,
  pathLabel,
  pathOneOffs,
  s001,
  type AlexiaPathId,
} from "@/lib/ubs/alexia";
import { CardHeader, Disclosure } from "./ui";

/** Real twin on the headline seed and paths: the number on a path is the headline after "Apply". */
function headline(base: Profile, s: Scenario): SimResult {
  const b = analyzeBehavior(effectiveProfile(base, s), s.extraTx);
  return simulate(simInputFor(base, s, b.params));
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 120;
  const h = 32;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const y = (v: number) => h - ((v - min) / span) * h;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />
      <polyline points={pts} fill="none" stroke="var(--series-1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * The UBS starter kit's reference example: Alexia's three paths from `scenario_config.json`, side by side.
 * Inputs (the ledger the config implies) and engine outputs (1,000 simulated futures) are shown separately.
 * "Apply" changes the twin (the previous state is auto-pinned as Plan A); "Pin as Plan A" pins a path without
 * applying it, so the next one is compared against it.
 */
export default function AlexiaPaths({
  base,
  scenario,
  activePath,
  onApply,
  onPin,
}: {
  base: Profile;
  /** The account's starting scenario (paths are scored on it, so a card number equals the headline after Apply). */
  scenario: Scenario;
  activePath?: string;
  onApply: (next: Scenario, id: AlexiaPathId) => void;
  onPin: (next: Scenario, id: AlexiaPathId) => void;
}) {
  const { t, tm, fmt, rich } = useI18n();
  const paths = useMemo(() => alexiaPaths(), []);
  const s = useMemo(() => s001(), []);
  const [useS001, setUseS001] = useState(true);
  const [results, setResults] = useState<{ key: string; byId: Partial<Record<AlexiaPathId, SimResult>> } | null>(null);
  const key = `${base.id}:${useS001}:${JSON.stringify(scenario)}`;

  // Three full simulations, one per timer tick so the page stays responsive.
  useEffect(() => {
    let cancelled = false;
    const byId: Partial<Record<AlexiaPathId, SimResult>> = {};
    const timers: ReturnType<typeof setTimeout>[] = [];
    ALEXIA_PATH_IDS.forEach((id, i) => {
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          byId[id] = headline(base, applyPath(scenario, id, paths[i], useS001));
          setResults({ key, byId: { ...byId } });
        }, 120 + i * 30),
      );
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [key, base, scenario, paths, useS001]);

  const yearsShown = [2, 5, 10];
  return (
    <section className="card p-5 sm:p-6 lg:col-span-2" data-testid="alexia-paths">
      <CardHeader title={t("ubs.alexiaTitle")} aside={<span className="text-xs text-ink-3">{t("ubs.alexiaSource")}</span>} />
      <p className="text-sm text-ink-2">{t("ubs.alexiaIntro", { cash: base.cash })}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {ALEXIA_PATH_IDS.map((id, i) => {
          const path = paths[i];
          const oneOffs = pathOneOffs(id, path, useS001);
          const ledger = alexiaLedger(path, base.cash, 120, oneOffs);
          const low = ledger.reduce((m, v, j) => (v < m.v ? { v, j } : m), { v: Infinity, j: 0 });
          const firstNegative = ledger.findIndex((v) => v < 0);
          const r = results?.key === key ? results.byId[id] : undefined;
          const applied = activePath?.startsWith(id);
          return (
            <div key={id} className={`flex flex-col rounded-xl border p-3 ${applied ? "border-ink" : "border-line"}`} data-path={id}>
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="font-medium">{tm(pathLabel(id))}</h4>
                {applied && <span className="text-[10px] font-semibold text-ink">{t("ubs.pathActive")}</span>}
              </div>
              <p className="mt-0.5 text-[11px] text-ink-2">
                {path.phases.map((ph) => t("ubs.phase", { from: ph.startMonth, to: ph.endMonth, income: ph.monthlyIncomeChf, spend: ph.monthlyExpensesChf })).join(" · ")}
                {oneOffs.length > 0 && <> · {t("ubs.oneOffs", { amounts: oneOffs.map((o) => t("ubs.oneOff", { amount: o.amountChf, month: o.month })) })}</>}
              </p>
              {id === "master" && s && (
                <label className="mt-1.5 flex items-start gap-1.5 text-[11px] text-ink-2">
                  <input type="checkbox" className="mt-0.5" checked={useS001} onChange={(e) => setUseS001(e.currentTarget.checked)} />
                  <span>{t("ubs.s001Toggle", { tuition: s.tuition, years: s.years })}</span>
                </label>
              )}

              <div className="label mt-3">{t("ubs.ledgerTitle")}</div>
              <Sparkline values={ledger} label={t("ubs.sparkAria", { label: tm(pathLabel(id)) })} />
              <dl className="num mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                {yearsShown.map((y) => (
                  <div key={y} className="contents">
                    <dt className="text-ink-2">{t("ubs.cashAfter", { count: y })}</dt>
                    <dd className={`text-right ${ledger[y * 12 - 1] < 0 ? "text-bad" : ""}`}>{fmt.chf(ledger[y * 12 - 1])}</dd>
                  </div>
                ))}
              </dl>
              <p className={`mt-1 text-[11px] ${firstNegative >= 0 ? "text-bad" : "text-ink-2"}`}>
                {firstNegative >= 0
                  ? t("ubs.breach", { month: firstNegative + 1, low: low.v })
                  : t("ubs.noBreach", { low: low.v })}
              </p>

              <div className="label mt-3">{t("ubs.engineTitle")}</div>
              {r ? (
                <dl className="num mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-ink-2">{t("ubs.pathGoal")}</dt>
                  <dd className={`text-right font-semibold ${r.successProb >= 0.8 ? "text-good" : r.successProb >= 0.5 ? "text-warn" : "text-bad"}`}>{fmt.pct(r.successProb)}</dd>
                  <dt className="text-ink-2">{t("ubs.pathCrunch")}</dt>
                  <dd className="text-right">{fmt.pct(r.crunchProb)}</dd>
                  <dt className="text-ink-2">{t("ubs.pathNetWorth")}</dt>
                  <dd className="text-right">{fmt.chf(r.bands[10]?.p50 ?? 0)}</dd>
                </dl>
              ) : (
                <p className="pulse-soft mt-1 text-xs text-ink-3">{t("plan.simulating")}</p>
              )}

              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                <button
                  type="button"
                  disabled={applied}
                  onClick={() => onApply(applyPath(scenario, id, path, useS001), id)}
                  className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-bg transition hover:opacity-90 disabled:opacity-40"
                  data-action="apply"
                >
                  {t("ubs.apply")}
                </button>
                <button
                  type="button"
                  onClick={() => onPin(applyPath(scenario, id, path, useS001), id)}
                  className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-2 transition hover:border-ink-3 hover:text-ink"
                  data-action="pin"
                >
                  {t("ubs.pinA")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <Disclosure summary={t("ubs.alexiaHow")} className="mt-4">
        <ul className="max-w-3xl list-disc space-y-1 pl-4 text-xs text-ink-2">
          <li>{t("ubs.alexiaHowLedger")}</li>
          <li>{rich("ubs.alexiaHowEngine", { goal: <b className="text-ink">{tm(base.goal.label)}</b> })}</li>
          <li>{t("ubs.alexiaHowAbroad")}</li>
          {s && <li>{t("ubs.alexiaHowS001", { tuition: s.tuition, years: s.years, ids: s.ids.join(", ") })}</li>}
          <li>{t("ubs.alexiaHowNote")}</li>
        </ul>
      </Disclosure>
    </section>
  );
}
