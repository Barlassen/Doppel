"use client";

import type { RetirementStats } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";

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
  const { t, fmt, rich } = useI18n();
  const ok = stats ? stats.lastsTo90Prob >= 0.8 : false;
  const meh = stats ? stats.lastsTo90Prob >= 0.5 : false;
  const gap = stats ? stats.monthlySpending - stats.monthlyIncomeAtRetirement : 0;
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="label">{t("retire.title")}</div>
        <div className="flex items-center gap-1 rounded-full border border-line px-1 text-xs">
          <button
            className="rounded-full px-1.5 py-0.5 text-ink-2 hover:text-ink disabled:opacity-40"
            disabled={disabled || retirementAge <= 55}
            onClick={() => onChangeAge(retirementAge - 1)}
            title={t("retire.earlier")}
            aria-label={t("retire.earlier")}
          >
            −
          </button>
          <span className="num font-medium">{t("retire.at", { age: retirementAge })}</span>
          <button
            className="rounded-full px-1.5 py-0.5 text-ink-2 hover:text-ink disabled:opacity-40"
            disabled={disabled || retirementAge >= 70}
            onClick={() => onChangeAge(retirementAge + 1)}
            title={t("retire.later")}
            aria-label={t("retire.later")}
          >
            +
          </button>
        </div>
      </div>
      {!stats ? (
        <p className="pulse-soft text-sm text-ink-3">{t("retire.simulating")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-2">
            {rich("retire.lasts", { odds: <b className={`num text-lg ${ok ? "text-good" : meh ? "text-warn" : "text-bad"}`}>{fmt.pct(stats.lastsTo90Prob)}</b> })}{" "}
            {stats.depletionAgeP10 !== null
              ? rich("retire.badCase", { age: <b className="num text-ink">{stats.depletionAgeP10}</b> })
              : t("retire.badCaseOk")}
          </p>
          <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
            <dt className="text-ink-3">{t("retire.ahv")}</dt>
            <dd className="text-right">{t("common.perMonth", { amount: fmt.chf(stats.ahvMonthly) })}</dd>
            <dt className="text-ink-3">{t("retire.bvg", { age: stats.age })}</dt>
            <dd className="text-right">{t("common.perMonth", { amount: fmt.chf(stats.bvgMonthly) })}</dd>
            <dt className="font-medium text-ink-2">{t("retire.income")}</dt>
            <dd className="text-right font-medium">{t("common.perMonth", { amount: fmt.chf(stats.monthlyIncomeAtRetirement) })}</dd>
            <dt className="text-ink-3">{t("retire.spending")}</dt>
            <dd className="text-right">{t("common.perMonth", { amount: fmt.chf(stats.monthlySpending) })}</dd>
            <dt className="text-ink-3">{t("retire.gap")}</dt>
            <dd className={`text-right ${gap > 0 ? "text-bad" : "text-good"}`}>{gap > 0 ? t("common.perMonth", { amount: fmt.chf(gap) }) : t("retire.gapNone")}</dd>
            <dt className="text-ink-3">{t("retire.savingsAt", { age: stats.age })}</dt>
            <dd className="text-right">{fmt.chfShort(stats.medianLiquidAtRetirement)}</dd>
            <dt className="text-ink-3">{t("retire.replacement")}</dt>
            <dd className="text-right">
              {fmt.pct(stats.replacementRatio)} <span className="text-ink-3">{t("retire.replacementNote")}</span>
            </dd>
          </dl>
          {stats.bridgeYears > 0 && (
            <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-ink">
              {t("retire.bridge", { age: stats.age, count: stats.bridgeYears })}
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-3">
            {t("retire.footnote")}
          </p>
        </>
      )}
    </section>
  );
}
