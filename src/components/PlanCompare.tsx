"use client";

import type { SimResult } from "@/lib/finance/types";
import { chfShort, pct } from "@/lib/format";

export interface PinnedPlan {
  label: string;
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
  if (!plan) {
    return (
      <button
        onClick={onPin}
        className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-2 transition hover:border-ink-3 hover:text-ink"
        title="Snapshot the current plan and compare every change against it"
      >
        📌 Pin as Plan A
      </button>
    );
  }
  const dpp = a ? Math.round((b.successProb - a.successProb) * 100) : null;
  const dchf = a ? b.medianAtGoal - a.medianAtGoal : null;
  const sign = (x: number) => (x > 0 ? "+" : x < 0 ? "−" : "±");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-full border border-line bg-surface py-1 pr-1 pl-3 text-xs">
      <span className="flex items-center gap-1.5 text-ink-2">
        <span className="inline-block h-0 w-4 border-t-2 border-dotted" style={{ borderColor: "var(--ink-3)" }} />
        Plan A{plan.manual ? " 📌" : ""}: <span className="max-w-[16rem] truncate text-ink">{plan.label}</span>
      </span>
      {a ? (
        <span className="num font-medium">
          {pct(a.successProb)} → {pct(b.successProb)}{" "}
          <span className={dpp! > 0 ? "text-good" : dpp! < 0 ? "text-bad" : "text-ink-3"}>
            ({sign(dpp!)}
            {Math.abs(dpp!)} pp)
          </span>
          <span className="text-ink-3"> · at {goalAge}: </span>
          <span className={dchf! > 0 ? "text-good" : dchf! < 0 ? "text-bad" : "text-ink-3"}>
            {sign(dchf!)}CHF {chfShort(Math.abs(dchf!))}
          </span>
        </span>
      ) : (
        <span className="pulse-soft text-ink-3">simulating…</span>
      )}
      <button onClick={onPin} className="rounded-full px-2 py-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink" title="Pin the current plan as Plan A">
        📌
      </button>
      <button onClick={onUnpin} className="rounded-full px-2 py-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink" title="Clear Plan A">
        ✕
      </button>
    </div>
  );
}
