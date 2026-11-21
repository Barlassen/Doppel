"use client";

import type { AffordabilityResult } from "@/lib/finance/swissRules";
import { MAX_COST_TO_INCOME } from "@/lib/finance/swissRules";
import type { BehaviorProfile } from "@/lib/finance/behavioralEngine";
import type { Recipe } from "@/lib/finance/goalSolver";
import type { HabitCosts } from "@/lib/finance/scenario";
import type { LifeEvent } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Text } from "@/lib/i18n/types";

const EVENT_ICON: Record<LifeEvent["type"], string> = {
  house: "🏠",
  child: "👶",
  jobloss: "💼",
  crash: "📉",
  raise: "📈",
  expense: "🎯",
  income: "💰",
};

export function Timeline({
  events,
  age,
  onShift,
  onRemove,
}: {
  events: LifeEvent[];
  age: number;
  onShift: (id: string, m: number) => void;
  onRemove: (id: string) => void;
}) {
  const { t, fmt, tm, mounted } = useI18n();
  const sorted = [...events].sort((a, b) => a.month - b.month);
  return (
    <div>
      <div className="label mb-2">{t("timeline.title")}</div>
      {sorted.length === 0 && <p className="text-sm text-ink-3">{t("timeline.empty")}</p>}
      <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {sorted.map((e) => (
          <li key={e.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <span>{EVENT_ICON[e.type]}</span>
            <div className="min-w-0">
              <div className="truncate font-medium">{tm(e.labelMsg ?? e.label)}</div>
              <div className="num text-[11px] text-ink-3">
                {mounted && t("timeline.when", { date: fmt.monthYear(e.month), age: age + Math.floor(e.month / 12) })}
                {e.amount !== 0 && t(e.type === "child" ? "timeline.amountMonthly" : "timeline.amount", { amount: e.amount })}
                {e.durationMonths && e.type === "jobloss" ? t("timeline.duration", { months: e.durationMonths }) : ""}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1 pl-2">
              <IconBtn onClick={() => onShift(e.id, -6)} title={t("timeline.eventAction", { label: e.labelMsg ?? e.label, action: t("timeline.earlier") })} aria-label={t("timeline.eventAction", { label: e.labelMsg ?? e.label, action: t("timeline.earlier") })}>{t("timeline.earlierShort")}</IconBtn>
              <IconBtn onClick={() => onShift(e.id, 6)} title={t("timeline.eventAction", { label: e.labelMsg ?? e.label, action: t("timeline.later") })} aria-label={t("timeline.eventAction", { label: e.labelMsg ?? e.label, action: t("timeline.later") })}>{t("timeline.laterShort")}</IconBtn>
              <IconBtn onClick={() => onRemove(e.id)} title={t("timeline.eventAction", { label: e.labelMsg ?? e.label, action: t("common.remove") })} aria-label={t("timeline.eventAction", { label: e.labelMsg ?? e.label, action: t("common.remove") })}>✕</IconBtn>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IconBtn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...p} className="num rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 transition hover:bg-surface-2 hover:text-ink">
      {children}
    </button>
  );
}

/**
 * Bank test for the planned home. `result` must be computed from the simulator's median future at the purchase
 * date (see DoppelApp), so the card and the odds agree; `boughtProb` is the share of futures that pass.
 */
export function AffordabilityCard({
  result,
  label,
  month,
  boughtProb,
}: {
  result: AffordabilityResult;
  label: Text;
  month: number;
  boughtProb?: number;
}) {
  const { t, fmt, rich, mounted } = useI18n();
  const ratio = result.costToIncome;
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="label">{t("afford.title")}</div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${result.pass ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
          {t(result.pass ? "afford.passes" : "afford.fails")}
        </span>
      </div>
      <div className="font-medium">
        {t("common.priceLabel", { label, price: result.price })}
      </div>
      <div className="mb-3 text-xs text-ink-3">
        {mounted && t("afford.basis", { when: fmt.monthYear(month) })}
      </div>

      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-2">{t("afford.ratio")}</span>
        <span className="num font-semibold">
          {fmt.pct(ratio, 1)} <span className="text-ink-3">/ {fmt.pct(MAX_COST_TO_INCOME, 1)}</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-surface-2">
        <div
          className="h-2 rounded-full"
          style={{ width: `${Math.min(100, (ratio / 0.5) * 100)}%`, background: result.pass ? "var(--good)" : "var(--bad)" }}
        />
        <div className="absolute top-[-3px] h-[14px] w-[2px] bg-ink" style={{ left: `${(MAX_COST_TO_INCOME / 0.5) * 100}%` }} />
      </div>

      <dl className="num mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-ink-3">{t("afford.equity")}</dt>
        <dd className="text-right">{fmt.chf(result.equityUsed)}</dd>
        <dt className="text-ink-3">{t("afford.mortgage")}</dt>
        <dd className="text-right">{fmt.chf(result.loan)}</dd>
        <dt className="text-ink-3">{t("afford.imputed")}</dt>
        <dd className="text-right">{fmt.chf(result.yearlyCost.total)}</dd>
        {result.closingCosts > 0 && (
          <>
            <dt className="text-ink-3">{t("afford.closing")}</dt>
            <dd className="text-right">{fmt.chf(result.closingCosts)}</dd>
          </>
        )}
        <dt className="text-ink-3">{t("afford.maxPrice")}</dt>
        <dd className="text-right">{fmt.chf(result.maxPrice)}</dd>
      </dl>
      {boughtProb !== undefined && (
        <p className="mt-3 text-xs text-ink-2">
          {rich(boughtProb < 1 ? "afford.passShareSome" : "afford.passShare", {
            share: <b className="num text-ink">{fmt.pct(boughtProb)}</b>,
          })}
        </p>
      )}
      {!result.pass && (
        <p className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-xs text-ink">
          {result.equityGap > 0 && <>{rich("afford.missingEquity", {
            amount: <b className="num">{fmt.chf(result.equityGap)}</b>,
          })}{" "}</>}
          {result.incomeGap > 0 && rich(result.extraEquityToPass > 0 ? "afford.incomeShortOr" : "afford.incomeShort", {
            amount: <b className="num">{fmt.chf(result.incomeGap)}</b>,
            equity: <b className="num">{fmt.chf(result.extraEquityToPass)}</b>,
          })}
        </p>
      )}
    </section>
  );
}

export function BehaviorCard({
  behavior,
  costChf,
  habitCosts,
  crunchProb,
  goalAge,
}: {
  behavior: BehaviorProfile;
  costChf: number;
  habitCosts?: HabitCosts | null;
  crunchProb?: number;
  goalAge?: number;
}) {
  const { t, tm, fmt, rich } = useI18n();
  const month = behavior.thisMonth;
  return (
    <section className="card p-4 sm:p-5">
      <div className="label mb-1">{t("behavior.title")}</div>
      <p className="mb-3 text-sm text-ink-2">
        {rich("behavior.cost", { amount: <b className="num text-ink">{fmt.chf(Math.max(0, costChf))}</b> })}
      </p>
      {habitCosts && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <HabitChip label={t("behavior.habitLeakage")} pp={habitCosts.leakagePp} />
          <HabitChip label={t("behavior.habitPanic")} pp={habitCosts.panicPp} />
        </div>
      )}
      <ul className="space-y-2">
        {behavior.insights.map((i) => (
          <li key={i.id} className="rounded-lg bg-surface-2 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 text-sm font-medium">
              <span>{tm(i.title)}</span>
              {i.monthlyChf ? <span className="num text-xs text-ink-2">{t("behavior.approxPerMonth", { amount: i.monthlyChf })}</span> : null}
            </div>
            <div className="text-xs text-ink-2">{tm(i.detail)}</div>
          </li>
        ))}
        {behavior.insights.length === 0 && <li className="text-sm text-ink-3">{t("behavior.none")}</li>}
      </ul>
      <dl className="num mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-line pt-3 text-xs">
        <dt className="text-ink-3">
          {t(month.count > 0 ? "behavior.snappedWith" : "behavior.snapped", { count: month.count, months: behavior.historyMonths })}
        </dt>
        <dd className={`text-right ${month.discretionary > month.baseline ? "text-bad" : "text-ink"}`}>
          {fmt.chf(month.discretionary)} <span className="text-ink-3">{t("behavior.discretionary", { amount: month.baseline })}</span>
        </dd>
        {crunchProb !== undefined && (
          <>
            <dt className="text-ink-3">{goalAge ? t("behavior.crunchBefore", { age: goalAge }) : t("behavior.crunch")}</dt>
            <dd className={`text-right ${crunchProb > 0.05 ? "text-bad" : "text-ink"}`}>{t("common.ofFutures", { p: fmt.pct(crunchProb, crunchProb > 0 && crunchProb < 0.01 ? 1 : 0) })}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function HabitChip({ label, pp }: { label: string; pp: number }) {
  const { t, fmt } = useI18n();
  const v = Math.round(pp);
  return (
    <span className="rounded-full bg-surface-2 px-2.5 py-1">
      {label}{" "}
      <b className={`num ${v > 0 ? "text-bad" : "text-ink-2"}`}>{v > 0 ? t("common.pp", { value: fmt.signed(-v) }) : t("common.approxPp", { value: 0 })}</b>
    </span>
  );
}

export function RecipesCard({
  recipes,
  loading,
  baseProb,
  onApply,
}: {
  recipes: Recipe[];
  loading: boolean;
  baseProb: number;
  onApply: (r: Recipe) => void;
}) {
  const { t, fmt, tm, rich } = useI18n();
  const onTrack = baseProb >= 0.8 && recipes.length === 0;
  const anyFix = recipes.some((r) => r.reaches);
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-center justify-between">
        <div className="label">{t("recipes.title")}</div>
        {loading && <span className="pulse-soft text-[11px] text-ink-3">{t("recipes.solving")}</span>}
      </div>
      {onTrack ? (
        <p className="text-sm text-ink-2">{t("recipes.onTrack")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-2">
            {rich("recipes.intro", { odds: <span className="num">{fmt.pct(baseProb)}</span> })}
          </p>
          <ul className={`space-y-2 ${loading ? "opacity-60" : ""}`}>
            {recipes.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{tm(r.title)}</div>
                  <div className="text-xs text-ink-2">{tm(r.detail)}</div>
                </div>
                <div className="text-right">
                  {r.reaches ? (
                    <div className="num text-sm font-semibold text-good">{t("common.progressArrow", { value: fmt.pct(r.newProb) })}</div>
                  ) : (
                    <div className="text-[11px] leading-tight text-warn">
                      {t("recipes.improvesTo")}
                      <div className="num text-sm font-semibold">{fmt.pct(r.newProb)}</div>
                    </div>
                  )}
                  <button
                    onClick={() => onApply(r)}
                    disabled={loading}
                    aria-label={t("recipes.applyAria", { title: r.title })}
                    className="text-[11px] font-medium text-s1 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                  >
                    {t("recipes.apply")}
                  </button>
                </div>
              </li>
            ))}
            {!loading && !anyFix && <li className="text-sm text-ink-3">{t("recipes.noFix")}</li>}
          </ul>
        </>
      )}
    </section>
  );
}
