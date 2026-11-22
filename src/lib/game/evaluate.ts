/**
 * The evaluation bar. One number per position, computed by the deterministic simulator, never by a model:
 *
 *   E = w_goal · P(goal reached) + w_safe · (1 − P(cash crunch)) + w_wealth · W − w_down · S
 *
 *   W = clamp(0.5 + 0.25 · log2(median net worth / target), 0, 1.5) (0.5 on target, +0.25 per doubling, max at 16×)
 *   S = clamp((target − p10 net worth) / target, 0, 1)               (shortfall of the worst 10% of futures)
 *
 * The target is the glide-path target at the analysis horizon (the goal itself at goal age). W keeps rising well past
 * the goal, so a position that already reaches it still tells a wasteful move from a good one. E is shown ×100 as
 * "points"; a move's loss is the analogue of chess centipawns.
 */
import { simulate } from "./sim";
import type { Regime } from "./regime";
import { type GameState, targetAt, toSimInput } from "./state";

export type PresetId = "balanced" | "safety" | "growth";
export const PRESETS: PresetId[] = ["balanced", "safety", "growth"];

export interface Weights {
  goal: number;
  safe: number;
  wealth: number;
  down: number;
}

export const WEIGHT_PRESETS: Record<PresetId, Weights> = {
  balanced: { goal: 0.4, safe: 0.3, wealth: 0.2, down: 0.1 },
  safety: { goal: 0.25, safe: 0.45, wealth: 0.1, down: 0.2 },
  growth: { goal: 0.35, safe: 0.15, wealth: 0.4, down: 0.1 },
};

export interface EvalParts {
  pGoal: number;
  pCrunch: number;
  /** Median and p10 net worth at the horizon, start-year CHF. */
  median: number;
  p10: number;
  /** Glide-path target at the horizon, start-year CHF. */
  target: number;
  wealthScore: number;
  shortfall: number;
}

export interface Evaluation extends EvalParts {
  e: number;
}

export function combine(parts: Omit<EvalParts, "wealthScore" | "shortfall">, w: Weights): Evaluation {
  const target = Math.max(5000, parts.target);
  const ratio = parts.median > 0 ? parts.median / target : 0;
  const wealthScore = ratio > 0 ? Math.min(1.5, Math.max(0, 0.5 + 0.25 * Math.log2(ratio))) : 0;
  const shortfall = Math.min(1, Math.max(0, (target - parts.p10) / target));
  const e = w.goal * parts.pGoal + w.safe * (1 - parts.pCrunch) + w.wealth * wealthScore - w.down * shortfall;
  return { ...parts, wealthScore, shortfall, e };
}

/** E of a lost position (a hard constraint broke): the lowest value the formula can produce. */
export const mateValue = (w: Weights): Evaluation => ({
  pGoal: 0, pCrunch: 1, median: 0, p10: 0, target: 1, wealthScore: 0, shortfall: 1, e: -w.down,
});

export interface LeafConfig {
  paths: number;
  seed: number;
}

/**
 * Leaf evaluation: a rollout of the existing simulator from this position to the horizon age (hold policy), on a
 * fixed seed so sibling moves share common random numbers.
 */
export function evaluatePosition(s: GameState, horizonAge: number, regime: Regime, w: Weights, cfg: LeafConfig): Evaluation {
  const h = Math.max(horizonAge, s.age + 1);
  const res = simulate(toSimInput(s, h, regime, cfg.paths, cfg.seed));
  const band = res.bands[Math.min(res.bands.length - 1, h - s.age)];
  const k = s.priceIndex;
  return combine({ pGoal: res.successProb, pCrunch: res.crunchProb, median: res.medianAtGoal / k, p10: band.p10 / k, target: targetAt(s, h) }, w);
}

// ---------------- move labels ----------------

export type MoveLabel = "brilliant" | "best" | "good" | "inaccuracy" | "mistake" | "blunder" | "lifeChoice";

/** Loss thresholds in points (E × 100). */
export const LABEL_THRESHOLDS = { best: 0.05, good: 0.5, inaccuracy: 2, mistake: 6 } as const;

export const LABEL_GLYPH: Record<MoveLabel, string> = {
  brilliant: "!!",
  best: "!",
  good: "✓",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
  lifeChoice: "♡",
};

/**
 * Standard errors a loss must clear a threshold by before the harsher label is given. The loss is an estimate
 * from sampled futures, so a move is only called an inaccuracy, a mistake or a blunder when the futures support it.
 */
export const LABEL_CONFIDENCE = 2;

/**
 * The label of a move from its loss (points) and the standard error of that loss (points). "Best" is the engine's
 * best move (or an exact tie). Every other move is graded on the loss the futures support, loss − 2 standard errors.
 */
export function labelFor(lossPts: number, sacrifice: boolean, lifeChoice: boolean, sePts = 0): MoveLabel {
  if (lifeChoice) return "lifeChoice";
  if (lossPts <= LABEL_THRESHOLDS.best) return sacrifice ? "brilliant" : "best";
  const sure = lossPts - LABEL_CONFIDENCE * Math.max(0, sePts);
  if (sure < LABEL_THRESHOLDS.good) return "good";
  if (sure < LABEL_THRESHOLDS.inaccuracy) return "inaccuracy";
  if (sure < LABEL_THRESHOLDS.mistake) return "mistake";
  return "blunder";
}

/** Per-move accuracy from the loss in points (Lichess' formula on win-% drops). */
export function moveAccuracy(lossPts: number): number {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, lossPts)) - 3.1669));
}
