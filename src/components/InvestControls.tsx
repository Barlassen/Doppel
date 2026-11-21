"use client";

import type { WaitingCost } from "@/lib/finance/scenario";
import { PILLAR_3A_MAX } from "@/lib/finance/swissRules";
import type { RiskProfile } from "@/lib/finance/types";
import { RISK_PROFILES } from "@/lib/finance/types";
import { EQUITY_WEIGHT } from "@/lib/finance/monteCarlo";
import { chf, pct } from "@/lib/format";

const RISK_LABEL: Record<RiskProfile, string> = { conservative: "Conservative", balanced: "Balanced", growth: "Growth" };

/** Hero controls: investment risk profile + pillar 3a toggle. */
export function InvestControls({
  risk,
  onRisk,
  contributes3a,
  on3a,
  monthlyInvest,
  onClearInvest,
  panicHistory,
  marginalTaxRate,
}: {
  risk: RiskProfile;
  onRisk: (r: RiskProfile) => void;
  contributes3a: boolean;
  on3a: (v: boolean) => void;
  monthlyInvest: number;
  onClearInvest: () => void;
  panicHistory: boolean;
  marginalTaxRate: number;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex rounded-full border border-line p-0.5" role="radiogroup" aria-label="Investment risk">
          {RISK_PROFILES.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={r === risk}
              onClick={() => onRisk(r)}
              title={`${Math.round(EQUITY_WEIGHT[r] * 100)}% equities`}
              className={`rounded-full px-2.5 py-1 font-medium transition ${r === risk ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
            >
              {RISK_LABEL[r]} <span className="num opacity-60">{Math.round(EQUITY_WEIGHT[r] * 100)}%</span>
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1 font-medium text-ink-2">
          <input type="checkbox" checked={contributes3a} onChange={(e) => on3a(e.target.checked)} className="accent-[var(--series-1)]" />
          Pillar 3a {contributes3a ? "maxed" : "off"}
        </label>
        {monthlyInvest > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3">
            Standing order {chf(monthlyInvest)}/mo invested
            <button onClick={onClearInvest} className="rounded-full px-1.5 text-ink-3 hover:text-ink">
              ✕
            </button>
          </span>
        )}
      </div>
      {!contributes3a && (
        <p className="mt-2 text-xs text-ink-2">
          💡 3a tax left on the table: <b className="num text-ink">{chf(PILLAR_3A_MAX * marginalTaxRate)}</b>/yr (CHF{" "}
          {PILLAR_3A_MAX.toLocaleString("de-CH")} at your {pct(marginalTaxRate)} marginal rate).
        </p>
      )}
      {risk === "growth" && panicHistory && (
        <p className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-ink">
          ⚠️ Growth means deeper dips — and you sold in the last one. Your twin keeps that habit: more equities only pay if you
          hold through the drawdown.
        </p>
      )}
    </div>
  );
}

/** Cost of waiting: odds if the idle cash is put to work now, in 2 or in 5 years. */
export function WaitingStrip({ items, loading }: { items: WaitingCost[] | null | undefined; loading?: boolean }) {
  if (items === null) return null;
  const now = items?.[0]?.prob ?? 0;
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="label">Cost of waiting</div>
        <span className="text-[11px] text-ink-3">invest idle cash + max 3a, starting…</span>
      </div>
      {!items ? (
        <p className="pulse-soft text-sm text-ink-3">Simulating…</p>
      ) : (
        <div className={`grid grid-cols-4 gap-2 ${loading ? "opacity-60" : ""}`}>
          {items.map((w) => (
            <div key={w.label} className="rounded-lg bg-surface-2 px-3 py-2">
              <div className="text-[11px] text-ink-3">{w.label}</div>
              <div className={`num text-lg font-semibold ${w.prob >= 0.8 ? "text-good" : w.prob >= 0.5 ? "text-warn" : "text-bad"}`}>{pct(w.prob)}</div>
              {w.label !== "Now" && <div className="num text-[11px] text-ink-3">{w.prob < now ? `−${Math.round((now - w.prob) * 100)} pp` : "±0 pp"}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
