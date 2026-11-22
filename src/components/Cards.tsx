"use client";

import type { AffordabilityResult } from "@/lib/finance/swissRules";
import { MAX_COST_TO_INCOME } from "@/lib/finance/swissRules";
import type { BehaviorProfile } from "@/lib/finance/behavioralEngine";
import type { Recipe } from "@/lib/finance/goalSolver";
import type { HabitCosts } from "@/lib/finance/scenario";
import type { LifeEvent } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Text } from "@/lib/i18n/types";
import type { FloorPlanVerification } from "@/lib/snap/vision";
import { FloorPlanAffordabilitySummary } from "./VisionReview";
import { CardHeader, Disclosure } from "./ui";

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
  start,
}: {
  events: LifeEvent[];
  age: number;
  onShift: (id: string, m: number) => void;
  onRemove: (id: string) => void;
  /** Month 0 of the profile (a dataset's as-of date); default today. */
  start?: Date;
}) {
  const { t, fmt, tm, mounted } = useI18n();
  const sorted = [...events].sort((a, b) => a.month - b.month);
  return (
    <div>
      <h3 className="label mb-2">{t("timeline.title")}</h3>
      {sorted.length === 0 && <p className="text-sm text-ink-2">{t("timeline.empty")}</p>}
      <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {sorted.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span>{EVENT_ICON[e.type]}</span>
            <div className="min-w-0 flex-1 basis-32">
              <div className="font-medium break-words">{tm(e.labelMsg ?? e.label)}</div>
              <div className="num text-xs text-ink-2">
                {(mounted || start) && t("timeline.when", { date: fmt.monthYear(e.month, start), age: age + Math.floor(e.month / 12) })}
                {e.amount !== 0 && t(e.type === "child" ? "timeline.amountMonthly" : "timeline.amount", { amount: e.amount })}
                {e.durationMonths && e.type === "jobloss" ? t("timeline.duration", { months: e.durationMonths }) : ""}
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
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
    <button {...p} className="num rounded-md px-1.5 py-0.5 text-[11px] text-ink-2 transition hover:bg-surface hover:text-ink">
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
  floorPlan,
  start,
}: {
  result: AffordabilityResult;
  label: Text;
  month: number;
  boughtProb?: number;
  floorPlan?: FloorPlanVerification | null;
  start?: Date;
}) {
  const { t, fmt, rich, mounted } = useI18n();
  const ratio = result.costToIncome;
  return (
    <section className="card p-5 sm:p-6">
      <CardHeader
        title={t("afford.title")}
        aside={
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${result.pass ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
            {t(result.pass ? "afford.passes" : "afford.fails")}
          </span>
        }
      />
      <div className="mb-4 font-medium break-words">
        {t("common.priceLabel", { label, price: result.price })}
      </div>
      {floorPlan && <FloorPlanAffordabilitySummary floorPlan={floorPlan} price={result.price} />}

      <div className="mb-1.5 flex justify-between gap-3 text-xs">
        <span className="text-ink-2">{t("afford.ratio")}</span>
        <span className="num font-semibold">
          {fmt.pct(ratio, 1)} <span className="font-normal text-ink-2">/ {fmt.pct(MAX_COST_TO_INCOME, 1)}</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-surface-2">
        <div
          className="h-2 rounded-full"
          style={{ width: `${Math.min(100, (ratio / 0.5) * 100)}%`, background: result.pass ? "var(--good)" : "var(--bad)" }}
        />
        <div className="absolute top-[-3px] h-[14px] w-[2px] bg-ink" style={{ left: `${(MAX_COST_TO_INCOME / 0.5) * 100}%` }} />
      </div>

      {!result.pass && (
        <p className="mt-4 rounded-lg bg-bad/10 px-3 py-2 text-xs text-ink">
          {result.equityGap > 0 && <>{rich("afford.missingEquity", {
            amount: <b className="num">{fmt.chf(result.equityGap)}</b>,
          })}{" "}</>}
          {result.incomeGap > 0 && rich(result.extraEquityToPass > 0 ? "afford.incomeShortOr" : "afford.incomeShort", {
            amount: <b className="num">{fmt.chf(result.incomeGap)}</b>,
            equity: <b className="num">{fmt.chf(result.extraEquityToPass)}</b>,
          })}
        </p>
      )}

      <Disclosure summary={t("common.details")} className="mt-4">
        <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
          <dt className="text-ink-2">{t("afford.equity")}</dt>
          <dd className="text-right">{fmt.chf(result.equityUsed)}</dd>
          <dt className="text-ink-2">{t("afford.mortgage")}</dt>
          <dd className="text-right">{fmt.chf(result.loan)}</dd>
          <dt className="text-ink-2">{t("afford.imputed")}</dt>
          <dd className="text-right">{fmt.chf(result.yearlyCost.total)}</dd>
          {result.otherDebtYear ? (
            <>
              <dt className="text-ink-2">{t("ubs.affordOtherDebt")}</dt>
              <dd className="text-right">{fmt.chf(result.otherDebtYear)}</dd>
            </>
          ) : null}
          {result.closingCosts > 0 && (
            <>
              <dt className="text-ink-2">{t("afford.closing")}</dt>
              <dd className="text-right">{fmt.chf(result.closingCosts)}</dd>
            </>
          )}
          <dt className="text-ink-2">{t("afford.maxPrice")}</dt>
          <dd className="text-right">{fmt.chf(result.maxPrice)}</dd>
        </dl>
        {boughtProb !== undefined && (
          <p className="mt-3 text-xs text-ink-2">
            {rich(boughtProb < 1 ? "afford.passShareSome" : "afford.passShare", {
              share: <b className="num text-ink">{fmt.pct(boughtProb)}</b>,
            })}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-2">{(mounted || start) && t("afford.basis", { when: fmt.monthYear(month, start) })}</p>
      </Disclosure>
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
  const none = behavior.insights.length === 0;
  return (
    <section className="card p-5 sm:p-6">
      <CardHeader title={t("behavior.title")} />
      <p className="text-sm text-ink-2">
        {rich("behavior.cost", { amount: <b className="num text-ink">{fmt.chf(Math.max(0, costChf))}</b> })}
      </p>
      {habitCosts && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <HabitChip label={t("behavior.habitLeakage")} pp={habitCosts.leakagePp} />
          <HabitChip label={t("behavior.habitPanic")} pp={habitCosts.panicPp} />
        </div>
      )}
      {none && <p className="mt-3 text-sm text-ink-2">{t("behavior.none")}</p>}
      <Disclosure summary={t("common.details")} className="mt-4">
        {!none && (
          <ul className="divide-y divide-line">
            {behavior.insights.map((i) => (
              <li key={i.id} className="py-2.5 first:pt-0">
                <div className="flex items-baseline justify-between gap-3 text-sm font-medium">
                  <span>{tm(i.title)}</span>
                  {i.monthlyChf ? <span className="num shrink-0 text-xs text-ink-2">{t("behavior.approxPerMonth", { amount: i.monthlyChf })}</span> : null}
                </div>
                <div className="mt-0.5 text-xs text-ink-2">{tm(i.detail)}</div>
              </li>
            ))}
          </ul>
        )}
        <dl className={`num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs ${none ? "" : "mt-2 border-t border-line pt-3"}`}>
          <dt className="text-ink-2">
            {t(month.count > 0 ? "behavior.snappedWith" : "behavior.snapped", { count: month.count, months: behavior.historyMonths })}
          </dt>
          <dd className={`text-right ${month.discretionary > month.baseline ? "text-bad" : "text-ink"}`}>
            {fmt.chf(month.discretionary)} <span className="text-ink-2">{t("behavior.discretionary", { amount: month.baseline })}</span>
          </dd>
          {crunchProb !== undefined && (
            <>
              <dt className="text-ink-2">{goalAge ? t("behavior.crunchBefore", { age: goalAge }) : t("behavior.crunch")}</dt>
              <dd className={`text-right ${crunchProb > 0.05 ? "text-bad" : "text-ink"}`}>{t("common.ofFutures", { p: fmt.pct(crunchProb, crunchProb > 0 && crunchProb < 0.01 ? 1 : 0) })}</dd>
            </>
          )}
        </dl>
      </Disclosure>
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
    <section className="card p-5 sm:p-6">
      <CardHeader
        title={t("recipes.title")}
        aside={loading ? <span className="pulse-soft text-xs text-ink-2">{t("recipes.solving")}</span> : undefined}
      />
      {onTrack ? (
        <p className="text-sm text-ink-2">{t("recipes.onTrack")}</p>
      ) : (
        <>
          <ul className={`divide-y divide-line ${loading ? "opacity-60" : ""}`}>
            {recipes.map((r) => (
              <li key={r.id} className="flex items-center gap-4 py-3 first:pt-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{tm(r.title)}</div>
                  <div className="mt-0.5 text-xs text-ink-2">{tm(r.detail)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {r.reaches ? (
                    <div className="num text-sm font-semibold text-good">{t("common.progressArrow", { value: fmt.pct(r.newProb) })}</div>
                  ) : (
                    <div className="text-right text-[11px] leading-tight text-warn">
                      {t("recipes.improvesTo")}
                      <div className="num text-sm font-semibold">{fmt.pct(r.newProb)}</div>
                    </div>
                  )}
                  <button
                    onClick={() => onApply(r)}
                    disabled={loading}
                    aria-label={t("recipes.applyAria", { title: r.title })}
                    className="rounded-full border border-line px-3 py-1 text-xs font-medium text-s1 transition enabled:hover:border-s1 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("recipes.apply")}
                  </button>
                </div>
              </li>
            ))}
            {!loading && !anyFix && <li className="py-3 text-sm text-ink-2 first:pt-0">{t("recipes.noFix")}</li>}
          </ul>
          <Disclosure summary={t("common.howCalculated")} className="mt-3">
            <p className="text-xs text-ink-2">
              {rich("recipes.intro", { odds: <span className="num">{fmt.pct(baseProb)}</span> })}
            </p>
          </Disclosure>
        </>
      )}
    </section>
  );
}

/** "Your private banker": one button, then the narration (cloud text in the current locale, else the local template). */
export function BankerCard({
  text,
  loading,
  started,
  onExplain,
}: {
  text?: string;
  loading: boolean;
  started: boolean;
  onExplain: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="card p-5 sm:p-6">
      <CardHeader
        title={t("banker.title")}
        aside={
          <button
            onClick={onExplain}
            disabled={loading}
            className="rounded-full border border-line px-3 py-1 text-xs font-medium transition hover:border-ink-3 disabled:opacity-50"
          >
            {t(started ? "banker.refresh" : "banker.explain")}
          </button>
        }
      />
      {loading && <p className="pulse-soft text-sm text-ink-2">{t("banker.loading")}</p>}
      {!loading && text !== undefined && <p className="font-serif text-xl leading-snug">{t("common.quote", { text })}</p>}
      {!started && <p className="text-sm text-ink-2">{t("banker.hint")}</p>}
    </section>
  );
}
