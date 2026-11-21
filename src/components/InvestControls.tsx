"use client";

import type { WaitingCost } from "@/lib/finance/scenario";
import { PILLAR_3A_MAX } from "@/lib/finance/swissRules";
import type { RiskProfile } from "@/lib/finance/types";
import { RISK_PROFILES } from "@/lib/finance/types";
import { EQUITY_WEIGHT } from "@/lib/finance/monteCarlo";
import { useI18n } from "@/lib/i18n/I18nProvider";

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
  const { t, fmt, rich } = useI18n();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex rounded-full border border-line p-0.5" role="radiogroup" aria-label={t("invest.riskAria")}>
          {RISK_PROFILES.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={r === risk}
              onClick={() => onRisk(r)}
              title={t("invest.equities", { share: EQUITY_WEIGHT[r] })}
              className={`rounded-full px-2.5 py-1 font-medium transition ${r === risk ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
            >
              {t(`risk.${r}`)} <span className="num opacity-60">{fmt.pct(EQUITY_WEIGHT[r])}</span>
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1 font-medium text-ink-2">
          <input type="checkbox" checked={contributes3a} onChange={(e) => on3a(e.target.checked)} className="accent-[var(--series-1)]" />
          {t(contributes3a ? "invest.pillar3aOn" : "invest.pillar3aOff")}
        </label>
        {monthlyInvest > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3">
            {t("invest.standingOrder", { amount: monthlyInvest })}
            <button onClick={onClearInvest} aria-label={t("change.stopStandingOrder")} className="rounded-full px-1.5 text-ink-3 hover:text-ink">
              ✕
            </button>
          </span>
        )}
      </div>
      {!contributes3a && (
        <p className="mt-2 text-xs text-ink-2">
          {rich("invest.taxLeft", {
            amount: <b className="num text-ink">{fmt.chf(PILLAR_3A_MAX * marginalTaxRate)}</b>,
            max: PILLAR_3A_MAX,
            rate: marginalTaxRate,
          })}
        </p>
      )}
      {risk === "growth" && panicHistory && (
        <p className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-ink">
          {t("invest.growthWarning")}
        </p>
      )}
    </div>
  );
}

/** Cost of waiting: odds if the idle cash is put to work now, in 2 or in 5 years. */
export function WaitingStrip({ items, loading }: { items: WaitingCost[] | null | undefined; loading?: boolean }) {
  const { t, tm, fmt } = useI18n();
  if (items === null) return null;
  const now = items?.[0]?.prob ?? 0;
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="label">{t("waiting.title")}</div>
        <span className="text-[11px] text-ink-3">{t("waiting.subtitle")}</span>
      </div>
      {!items ? (
        <p className="pulse-soft text-sm text-ink-3">{t("waiting.simulating")}</p>
      ) : (
        <div className={`grid grid-cols-2 gap-2 min-[420px]:grid-cols-4 ${loading ? "opacity-60" : ""}`}>
          {items.map((w) => (
            <div key={w.startMonth} className="rounded-lg bg-surface-2 px-3 py-2">
              <div className="text-[11px] text-ink-3">{tm(w.label)}</div>
              <div className={`num text-lg font-semibold ${w.prob >= 0.8 ? "text-good" : w.prob >= 0.5 ? "text-warn" : "text-bad"}`}>{fmt.pct(w.prob)}</div>
              {w.startMonth !== 0 && <div className="num text-[11px] text-ink-3">{t("common.pp", {
                value: w.prob < now ? fmt.signed(-Math.round((now - w.prob) * 100)) : "±0",
              })}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
