import type { NaiveEstimate } from "./tokens";
import type { PipelineStep, Tier, Usage } from "@/lib/snap/types";

export interface LedgerEntry {
  id: string;
  at: number;
  kind: "snap" | "command" | "narrate";
  title: string;
  tier: Tier | "local-parser" | "llm";
  ms: number;
  usage: Usage;
  naive: NaiveEstimate;
  payload: unknown;
  steps?: PipelineStep[];
  preview?: string;
}

export function totals(entries: LedgerEntry[]) {
  const ours = entries.reduce((s, e) => s + e.usage.promptTokens + e.usage.completionTokens, 0);
  const naive = entries.reduce((s, e) => s + e.naive.promptTokens + e.naive.completionTokens, 0);
  const oursCost = entries.reduce((s, e) => s + e.usage.costUsd, 0);
  const naiveCost = entries.reduce((s, e) => s + e.naive.costUsd, 0);
  return { ours, naive, oursCost, naiveCost, saved: naive > 0 ? 1 - ours / naive : 0 };
}
