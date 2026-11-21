"use client";

import type { SimResult } from "@/lib/finance/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Text } from "@/lib/i18n/types";

export interface PinnedPlan {
  label: Text;
  /** true = pinned by the user (kept); false = auto-pinned right before a what-if/snap changed the twin. */
  manual: boolean;
}

/**
 * Plan A vs Plan B chip. Plan A is a snapshot of the scenario, re-simulated with the same seed —
 * so the difference is the decision, not luck.
 */
export function PlanCompare({
  plan,
  a,
  b,
  goalAge,
  onPin,
  onUnpin,
}: {
  plan: PinnedPlan | null;
  a?: SimResult | null;
  b: SimResult;
  goalAge: number;
  onPin: () => void;
  onUnpin: () => void;
}) {
  const { t, rich, fmt, tm } = useI18n();
  if (!plan) {
    return (
      <button
        onClick={onPin}
        className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-2 transition hover:border-ink-3 hover:text-ink"
        title={t("plan.pinTitle")}
      >
        {t("plan.pin")}
      </button>
    );
  }
  const dpp = a ? Math.round((b.successProb - a.successProb) * 100) : null;
  const dchf = a ? b.medianAtGoal - a.medianAtGoal : null;
  const sign = (x: number) => (x > 0 ? "+" : x < 0 ? "−" : "±");
  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface py-1 pr-1 pl-3 text-xs">
      <span className="min-w-0 text-ink-2">
        <span className="inline-block h-0 mr-1.5 w-4 align-middle border-t-2 border-dotted" style={{ borderColor: "var(--ink-3)" }} />
        {rich("plan.label", {
          marker: plan.manual ? " 📌" : "",
          label: <span className="inline-block max-w-[min(16rem,58vw)] truncate align-bottom text-ink">{tm(plan.label)}</span>,
        })}
      </span>
      {a ? (
        <span className="num font-medium">
          {t("common.arrow", { before: fmt.pct(a.successProb), after: fmt.pct(b.successProb) })}{" "}
          <span className={dpp! > 0 ? "text-good" : dpp! < 0 ? "text-bad" : "text-ink-3"}>
            {t("common.deltaPp", { value: sign(dpp!) + fmt.int(Math.abs(dpp!)) })}
          </span>
          <span className="text-ink-3">{t("plan.atGoal", { age: goalAge })}</span>
          <span className={dchf! > 0 ? "text-good" : dchf! < 0 ? "text-bad" : "text-ink-3"}>
            {t("common.deltaChf", { sign: sign(dchf!), amount: Math.abs(dchf!) })}
          </span>
        </span>
      ) : (
        <span className="pulse-soft text-ink-3">{t("plan.simulating")}</span>
      )}
      <button onClick={onPin} className="rounded-full px-2 py-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink" title={t("plan.repin")} aria-label={t("plan.repin")}>
        📌
      </button>
      <button onClick={onUnpin} className="rounded-full px-2 py-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink" title={t("plan.clear")} aria-label={t("plan.clear")}>
        ✕
      </button>
    </div>
  );
}
