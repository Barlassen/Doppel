"use client";

import type { RetirementStats } from "@/lib/finance/types";
import { chf, chfShort, pct } from "@/lib/format";

/** Answers "Am I saving enough for retirement?" with plain numbers from the simulator. */
export function RetirementCard({
  stats,
  retirementAge,
  onChangeAge,
  disabled,
}: {
  stats?: RetirementStats;
  retirementAge: number;
  onChangeAge: (age: number) => void;
  disabled?: boolean;
}) {
  const ok = stats ? stats.lastsTo90Prob >= 0.8 : false;
  const meh = stats ? stats.lastsTo90Prob >= 0.5 : false;
  const gap = stats ? stats.monthlySpending - stats.monthlyIncomeAtRetirement : 0;
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="label">Am I saving enough for retirement?</div>
        <div className="flex items-center gap-1 rounded-full border border-line px-1 text-xs">
          <button
            className="rounded-full px-1.5 py-0.5 text-ink-2 hover:text-ink disabled:opacity-40"
            disabled={disabled || retirementAge <= 55}
            onClick={() => onChangeAge(retirementAge - 1)}
            title="Retire a year earlier"
          >
            −
          </button>
          <span className="num font-medium">retire at {retirementAge}</span>
          <button
            className="rounded-full px-1.5 py-0.5 text-ink-2 hover:text-ink disabled:opacity-40"
            disabled={disabled || retirementAge >= 70}
            onClick={() => onChangeAge(retirementAge + 1)}
            title="Retire a year later"
          >
            +
          </button>
        </div>
      </div>
      {!stats ? (
        <p className="pulse-soft text-sm text-ink-3">Simulating to age 90…</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-2">
            Your savings last to 90 in{" "}
            <b className={`num text-lg ${ok ? "text-good" : meh ? "text-warn" : "text-bad"}`}>{pct(stats.lastsTo90Prob)}</b> of futures.{" "}
            {stats.depletionAgeP10 !== null ? (
              <>
                In a bad case (1 in 10) they run out at <b className="num text-ink">{stats.depletionAgeP10}</b>.
              </>
            ) : (
              <>Even in a bad case (1 in 10) they last beyond 90.</>
            )}
          </p>
          <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
            <dt className="text-ink-3">AHV (from 65, incl. 13th)</dt>
            <dd className="text-right">{chf(stats.ahvMonthly)}/mo</dd>
            <dt className="text-ink-3">Pension fund annuity (from {stats.age})</dt>
            <dd className="text-right">{chf(stats.bvgMonthly)}/mo</dd>
            <dt className="font-medium text-ink-2">Pension income</dt>
            <dd className="text-right font-medium">{chf(stats.monthlyIncomeAtRetirement)}/mo</dd>
            <dt className="text-ink-3">Spending in retirement</dt>
            <dd className="text-right">{chf(stats.monthlySpending)}/mo</dd>
            <dt className="text-ink-3">Gap paid from savings</dt>
            <dd className={`text-right ${gap > 0 ? "text-bad" : "text-good"}`}>{gap > 0 ? chf(gap) + "/mo" : "none"}</dd>
            <dt className="text-ink-3">Savings at {stats.age} (median)</dt>
            <dd className="text-right">{chfShort(stats.medianLiquidAtRetirement)}</dd>
            <dt className="text-ink-3">Replacement ratio</dt>
            <dd className="text-right">
              {pct(stats.replacementRatio)} <span className="text-ink-3">of last salary (rule of thumb 60–80%)</span>
            </dd>
          </dl>
          {stats.bridgeYears > 0 && (
            <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-ink">
              Retiring at {stats.age} means {stats.bridgeYears} years without AHV — the bridge is paid from your savings, and the
              pension fund converts at a lower rate.
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-3">
            Today&apos;s CHF, before tax. AHV max ×13/12 × 90% (contribution gaps); pension fund = capital × blended conversion rate
            (5.5% at 65, lower if earlier); spending ×0.8 except housing.
          </p>
        </>
      )}
    </section>
  );
}
