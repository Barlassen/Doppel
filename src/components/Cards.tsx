"use client";

import type { AffordabilityResult } from "@/lib/finance/swissRules";
import { MAX_COST_TO_INCOME } from "@/lib/finance/swissRules";
import type { BehaviorProfile } from "@/lib/finance/behavioralEngine";
import type { Recipe } from "@/lib/finance/goalSolver";
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
              <div className="num text-[11px] text-ink-3">
                {monthToLabel(e.month, age)}
                {e.amount > 0 && ` · ${chfShort(e.amount)}${e.type === "child" ? "/mo" : ""}`}
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

export function AffordabilityCard({ result, label, when }: { result: AffordabilityResult; label: string; when: string }) {
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
      <div className="mb-3 text-xs text-ink-3">projected for {when} · 5% stress rate, 1% upkeep, ⅓ of gross income</div>

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
        <dt className="text-ink-3">Max price today</dt>
        <dd className="text-right">{chf(result.maxPrice)}</dd>
      </dl>
      {!result.pass && (
        <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-xs text-ink">
          {result.equityGap > 0 && <>Missing equity: <b className="num">{chf(result.equityGap)}</b>. </>}
          {result.incomeGap > 0 && <>Gross income short by <b className="num">{chf(result.incomeGap)}</b>/yr.</>}
        </p>
      )}
    </section>
  );
}

export function BehaviorCard({ behavior, costChf }: { behavior: BehaviorProfile; costChf: number }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="label mb-1">Behavioural twin</div>
      <p className="mb-3 text-sm text-ink-2">
        Your habits cost you{" "}
        <b className="num text-ink">{chf(Math.max(0, costChf))}</b> by your goal date (median, today’s money).
      </p>
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
    </section>
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
          <p className="mb-3 text-sm text-ink-2">Smallest single moves that fix your plan, found by searching the simulator. Percentages are your new odds.</p>
          <ul className="space-y-2">
            {recipes.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-ink-2">{r.detail}</div>
                </div>
                <div className="text-right">
                  <div className="num text-sm font-semibold text-good">{pct(r.newProb)}</div>
                  <button onClick={() => onApply(r)} className="text-[11px] font-medium text-s1 hover:underline">
                    Apply
                  </button>
                </div>
              </li>
            ))}
            {!loading && recipes.length === 0 && <li className="text-sm text-ink-3">No single lever reaches 80% — try combining them.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
