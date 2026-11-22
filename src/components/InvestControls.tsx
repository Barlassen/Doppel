"use client";

import type { WaitingCost } from "@/lib/finance/scenario";
import { PILLAR_3A_MAX } from "@/lib/finance/swissRules";
import type { RiskProfile } from "@/lib/finance/types";
import { RISK_PROFILES } from "@/lib/finance/types";
import { EQUITY_WEIGHT } from "@/lib/finance/monteCarlo";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { CardHeader } from "./ui";

/**
 * Hero settings row: investment risk profile, pillar 3a toggle (with a short tax hint when it is off), the standing
 * order pill and `children` (Pin as Plan A) on one wrapping line. The full 3a sentence lives in the hero details
 * (see `TaxTip`); the growth warning stays visible below the row because it is a caution, not a detail.
 */
export function InvestControls({
  risk,
  onRisk,
  contributes3a,
  on3a,
  monthlyInvest,
  onClearInvest,
  panicHistory,
  marginalTaxRate,
  no3a,
  children,
}: {
  risk: RiskProfile;
  onRisk: (r: RiskProfile) => void;
  contributes3a: boolean;
  on3a: (v: boolean) => void;
  monthlyInvest: number;
  onClearInvest: () => void;
  panicHistory: boolean;
  marginalTaxRate: number;
  /** Already retired: no pillar 3a contributions are possible, so the toggle and its tax line are hidden. */
  no3a?: boolean;
  children?: ReactNode;
}) {
  const { t, fmt } = useI18n();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
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
        {!no3a && (
          <label className="flex cursor-pointer items-center gap-2 font-medium text-ink-2 hover:text-ink">
            <input type="checkbox" checked={contributes3a} onChange={(e) => on3a(e.target.checked)} className="accent-[var(--series-1)]" />
            {t(contributes3a ? "invest.pillar3aOn" : "invest.pillar3aOff")}
          </label>
        )}
        {!contributes3a && !no3a && (
          <span className="num text-ink-2">{t("invest.taxLeftShort", { amount: PILLAR_3A_MAX * marginalTaxRate })}</span>
        )}
        {monthlyInvest > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3">
            {t("invest.standingOrder", { amount: monthlyInvest })}
            <button onClick={onClearInvest} aria-label={t("change.stopStandingOrder")} className="rounded-full px-1.5 text-ink-3 hover:text-ink">
              ✕
            </button>
          </span>
        )}
        {children && <div className="min-w-0 sm:ml-auto">{children}</div>}
      </div>
      {risk === "growth" && panicHistory && (
        <p className="mt-3 max-w-3xl rounded-lg bg-warn/10 px-3 py-2 text-xs text-ink">
          {t("invest.growthWarning")}
        </p>
      )}
    </div>
  );
}

/** The full pillar 3a tax sentence (maximum, marginal rate), shown in the hero details while 3a is off. */
export function TaxTip({ marginalTaxRate }: { marginalTaxRate: number }) {
  const { fmt, rich } = useI18n();
  return (
    <>
      {rich("invest.taxLeft", {
        amount: <b className="num text-ink">{fmt.chf(PILLAR_3A_MAX * marginalTaxRate)}</b>,
        max: PILLAR_3A_MAX,
        rate: marginalTaxRate,
      })}
    </>
  );
}

/** Hairline dividers between the tiles: 2 columns below 420px, 4 columns above. */
const TILE_DIVIDERS = [
  "pr-3",
  "border-l border-line px-3",
  "pr-3 min-[420px]:border-l min-[420px]:border-line min-[420px]:pl-3",
  "border-l border-line px-3",
];

/** Cost of waiting: odds if the idle cash is put to work now, in 2 or in 5 years. */
export function WaitingStrip({ items, loading }: { items: WaitingCost[] | null | undefined; loading?: boolean }) {
  const { t, tm, fmt } = useI18n();
  if (items === null) return null;
  const now = items?.[0]?.prob ?? 0;
  return (
    <section className="card p-5 sm:p-6">
      <CardHeader title={t("waiting.title")} className="mb-1" />
      <p className="mb-4 text-sm text-ink-2">{t("waiting.subtitle")}</p>
      {!items ? (
        <p className="pulse-soft text-sm text-ink-2">{t("waiting.simulating")}</p>
      ) : (
        <div className={`grid grid-cols-2 gap-y-4 min-[420px]:grid-cols-4 ${loading ? "opacity-60" : ""}`}>
          {items.map((w, i) => (
            <div key={w.startMonth} className={TILE_DIVIDERS[i] ?? TILE_DIVIDERS[1]}>
              <div className="text-xs text-ink-2">{tm(w.label)}</div>
              <div className={`num text-xl font-semibold ${w.prob >= 0.8 ? "text-good" : w.prob >= 0.5 ? "text-warn" : "text-bad"}`}>{fmt.pct(w.prob)}</div>
              {w.startMonth !== 0 && <div className="num text-xs text-ink-2">{t("common.pp", {
                value: w.prob < now ? fmt.signed(-Math.round((now - w.prob) * 100)) : "±0",
              })}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
