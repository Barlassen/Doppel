"use client";

import type { AffordabilityResult } from "@/lib/finance/swissRules";
import { MAX_COST_TO_INCOME } from "@/lib/finance/swissRules";
import type { BehaviorProfile } from "@/lib/finance/behavioralEngine";
import type { Recipe } from "@/lib/finance/goalSolver";
import type { HabitCosts } from "@/lib/finance/scenario";
import type { LifeEvent } from "@/lib/finance/types";
import { chf, chfShort, monthToLabel, pct } from "@/lib/format";

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
  const sorted = [...events].sort((a, b) => a.month - b.month);
  return (
    <div>
      <div className="label mb-2">Life events</div>
      {sorted.length === 0 && <p className="text-sm text-ink-3">No events yet. Snap a listing or ask a what-if.</p>}
      <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {sorted.map((e) => (
          <li key={e.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <span>{EVENT_ICON[e.type]}</span>
            <div className="min-w-0">
              <div className="truncate font-medium">{e.label}</div>
              <div className="num text-[11px] text-ink-3" suppressHydrationWarning>
                {monthToLabel(e.month, age)}
                {e.amount !== 0 && ` · ${chfShort(e.amount)}${e.type === "child" ? "/mo" : ""}`}
                {e.durationMonths && e.type === "jobloss" ? ` · ${e.durationMonths} mo` : ""}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1 pl-2">
              <IconBtn onClick={() => onShift(e.id, -6)} title="6 months earlier">−6m</IconBtn>
              <IconBtn onClick={() => onShift(e.id, 6)} title="6 months later">+6m</IconBtn>
              <IconBtn onClick={() => onRemove(e.id)} title="Remove">✕</IconBtn>
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
  when,
  boughtProb,
}: {
  result: AffordabilityResult;
  label: string;
  when: string;
  boughtProb?: number;
}) {
  const ratio = result.costToIncome;
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="label">Bank affordability test</div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${result.pass ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
          {result.pass ? "✓ Passes" : "✕ Fails"}
        </span>
      </div>
      <div className="font-medium">
        {label} · {chf(result.price)}
      </div>
      <div className="mb-3 text-xs text-ink-3" suppressHydrationWarning>
        median future at purchase ({when}) · 5% stress rate, 1% upkeep, ⅓ of gross income
      </div>

      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-2">Cost / gross income</span>
        <span className="num font-semibold">
          {pct(ratio, 1)} <span className="text-ink-3">/ {pct(MAX_COST_TO_INCOME, 1)}</span>
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
        <dt className="text-ink-3">Equity in</dt>
        <dd className="text-right">{chf(result.equityUsed)}</dd>
        <dt className="text-ink-3">Mortgage</dt>
        <dd className="text-right">{chf(result.loan)}</dd>
        <dt className="text-ink-3">Imputed cost / yr</dt>
        <dd className="text-right">{chf(result.yearlyCost.total)}</dd>
        {result.closingCosts > 0 && (
          <>
            <dt className="text-ink-3">Closing costs (own funds)</dt>
            <dd className="text-right">{chf(result.closingCosts)}</dd>
          </>
        )}
        <dt className="text-ink-3">Max price at purchase</dt>
        <dd className="text-right">{chf(result.maxPrice)}</dd>
      </dl>
      {boughtProb !== undefined && (
        <p className="mt-3 text-xs text-ink-2">
          Passes in <b className="num text-ink">{pct(boughtProb)}</b> of simulated futures — the same test runs inside every future at the
          purchase date{boughtProb < 1 ? "; where it fails you keep renting and the goal counts as missed" : ""}.
        </p>
      )}
      {!result.pass && (
        <p className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-xs text-ink">
          {result.equityGap > 0 && (
            <>
              Missing equity: <b className="num">{chf(result.equityGap)}</b>.{" "}
            </>
          )}
          {result.incomeGap > 0 && (
            <>
              Gross income short by <b className="num">{chf(result.incomeGap)}</b>/yr
              {result.extraEquityToPass > 0 && (
                <>
                  {" "}
                  — or <b className="num">{chf(result.extraEquityToPass)}</b> more own funds
                </>
              )}
              .
            </>
          )}
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
  const tm = behavior.thisMonth;
  return (
    <section className="card p-4 sm:p-5">
      <div className="label mb-1">Behavioural twin</div>
      <p className="mb-3 text-sm text-ink-2">
        Your habits cost you <b className="num text-ink">{chf(Math.max(0, costChf))}</b> by your goal date (median, today’s money).
      </p>
      {habitCosts && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <HabitChip label="Payday & impulse spending" pp={habitCosts.leakagePp} />
          <HabitChip label="Panic selling" pp={habitCosts.panicPp} />
        </div>
      )}
      <ul className="space-y-2">
        {behavior.insights.map((i) => (
          <li key={i.id} className="rounded-lg bg-surface-2 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 text-sm font-medium">
              <span>{i.title}</span>
              {i.monthlyChf ? <span className="num text-xs text-ink-2">≈ {chf(i.monthlyChf)}/mo</span> : null}
            </div>
            <div className="text-xs text-ink-2">{i.detail}</div>
          </li>
        ))}
        {behavior.insights.length === 0 && <li className="text-sm text-ink-3">No costly patterns detected. 👏</li>}
      </ul>
      <dl className="num mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-line pt-3 text-xs">
        <dt className="text-ink-3">
          Snapped this month{tm.count > 0 ? ` (${tm.count} receipt${tm.count > 1 ? "s" : ""})` : ""} vs {behavior.historyMonths}-month baseline
        </dt>
        <dd className={`text-right ${tm.discretionary > tm.baseline ? "text-bad" : "text-ink"}`}>
          {chf(tm.discretionary)} <span className="text-ink-3">/ {chf(tm.baseline)} discretionary</span>
        </dd>
        {crunchProb !== undefined && (
          <>
            <dt className="text-ink-3">Cash-crunch risk{goalAge ? ` before ${goalAge}` : ""}</dt>
            <dd className={`text-right ${crunchProb > 0.05 ? "text-bad" : "text-ink"}`}>{pct(crunchProb, crunchProb > 0 && crunchProb < 0.01 ? 1 : 0)} of futures</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function HabitChip({ label, pp }: { label: string; pp: number }) {
  const v = Math.round(pp);
  return (
    <span className="rounded-full bg-surface-2 px-2.5 py-1">
      {label}{" "}
      <b className={`num ${v > 0 ? "text-bad" : "text-ink-2"}`}>{v > 0 ? `−${v} pp` : "≈ 0 pp"}</b>
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
  const onTrack = baseProb >= 0.8 && recipes.length === 0;
  const anyFix = recipes.some((r) => r.reaches);
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-center justify-between">
        <div className="label">Find my path</div>
        {loading && <span className="pulse-soft text-[11px] text-ink-3">solving…</span>}
      </div>
      {onTrack ? (
        <p className="text-sm text-ink-2">You are on track (≥ 80%). Nothing to fix — keep going.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-2">
            Smallest moves found by searching the simulator, scored on the same 1,000 futures as your headline (
            <span className="num">{pct(baseProb)}</span>).
          </p>
          <ul className={`space-y-2 ${loading ? "opacity-60" : ""}`}>
            {recipes.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-ink-2">{r.detail}</div>
                </div>
                <div className="text-right">
                  {r.reaches ? (
                    <div className="num text-sm font-semibold text-good">→ {pct(r.newProb)}</div>
                  ) : (
                    <div className="text-[11px] leading-tight text-warn">
                      improves to
                      <div className="num text-sm font-semibold">{pct(r.newProb)}</div>
                    </div>
                  )}
                  <button
                    onClick={() => onApply(r)}
                    disabled={loading}
                    className="text-[11px] font-medium text-s1 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                  >
                    Apply
                  </button>
                </div>
              </li>
            ))}
            {!loading && !anyFix && <li className="text-sm text-ink-3">No single lever reaches 80% — combine them, or adjust the goal.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
